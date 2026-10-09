import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ReadinessService } from '../sync/readiness.service';
import { FrequencyGuard } from '../frequency/frequency.guard';
import { ChannelAdapter } from '../../adapters/channel.adapter';
import { matchRulesForHouse, selectWinningRule, type RuleMatchInput } from '../../engine/rule-engine';
import { shanghaiCalendarDay } from '../../common/time.util';

/**
 * 每日跑批主链（ARCHITECTURE §5/§8）：
 * 同步就绪校验 -> 分页扫描 -> 规则匹配（互斥+优先级单包收敛）
 *  -> 闸门 0/0c/频控/窗口 -> 落 push_task/push_detail -> dry-run/真实发送。
 * 幂等：campaign_task.stat_date 唯一；同日重跑拒绝（需先失败/次日）。
 */
@Injectable()
export class CampaignRunnerService {
  private readonly logger = new Logger(CampaignRunnerService.name);
  private readonly SCAN_BATCH = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
    private readonly guard: FrequencyGuard,
    private readonly channel: ChannelAdapter,
    private readonly config: ConfigService,
  ) {}

  async run(statDate: Date = new Date()): Promise<{ campaignTaskId: string; status: string }> {
    // date 列统一存「上海自然日」的 UTC 午夜表示（Prisma @db.Date 按 UTC 日历日编解码）
    const day = shanghaiCalendarDay(statDate);

    // 幂等锁：同日已有任务即拒绝（pending/running/success 都不允许重复跑）
    const existed = await this.prisma.campaignTask.findUnique({ where: { statDate: day } });
    if (existed && existed.status !== 'failed') {
      return { campaignTaskId: existed.id.toString(), status: existed.status };
    }

    const task = await this.prisma.campaignTask.upsert({
      where: { statDate: day },
      create: { statDate: day, status: 'running', startedAt: new Date() },
      update: { status: 'running', startedAt: new Date(), finishedAt: null, errorMessage: null },
    });

    try {
      const report = await this.readiness.check(statDate);
      if (!report.labelReady) {
        throw new Error(`房屋标签未就绪（最新 stat_date=${report.labelStatDate?.toISOString().slice(0, 10)}），跑批中止`);
      }

      // 规则（含包与互斥组）
      const ruleRows = await this.prisma.mappingRule.findMany({ where: { status: 'enabled' } });
      const rules: RuleMatchInput[] = ruleRows.map((r) => ({
        id: r.id,
        packageId: r.packageId,
        priority: r.priority,
        mutexGroupId: r.mutexGroupId,
        conditionJson: r.conditionJson,
        status: r.status,
      }));

      // 每包选一个 published 海报模板（缺失不阻断）
      const posters = await this.prisma.posterTemplate.findMany({
        where: { status: 'published' },
        orderBy: { id: 'asc' },
      });
      const posterByPkg = new Map<bigint, bigint>();
      for (const p of posters) if (p.packageId) posterByPkg.set(p.packageId, p.id);

      // 频控规则 + 名单（房屋与号码 HMAC 双键）
      const { rule: freq, windows } = await this.guard.loadGlobalRule();
      const now = new Date();
      const suppressionRows = await this.prisma.suppressionList.findMany({
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      });
      const suppression = {
        optOutKeys: new Set<string>(
          suppressionRows.filter((s) => s.listType === 'unsubscribe').map((s) => s.targetValue),
        ),
        blacklistKeys: new Set<string>(
          suppressionRows.filter((s) => s.listType === 'blacklist').map((s) => s.targetValue),
        ),
      };
      const counter = await this.prisma.dailySendCounter.findUnique({ where: { statDate: day } });
      let todaySentGlobal = counter?.sentCount ?? 0;

      // 一个营销批次（一期单渠道企微；短信通道接入后按渠道拆批）
      const pushTask = await this.prisma.pushTask.create({
        data: { campaignTaskId: task.id, channel: 'wecom', msgType: 'marketing', status: 'queued' },
      });

      let scanned = 0;
      let matched = 0;
      let suppressed = 0;
      let queued = 0;
      let deferredCnt = 0;
      // 闸门 4：同家庭去重（同项目同房屋名指纹，批次内只保留一条）
      const familySeen = new Set<string>();

      let cursor: string | undefined;
      for (;;) {
        const houses = await this.prisma.houseLabelSnapshot.findMany({
          take: this.SCAN_BATCH,
          ...(cursor ? { cursor: { houseId: cursor }, skip: 1 } : {}),
          orderBy: { houseId: 'asc' },
        });
        if (houses.length === 0) break;

        for (const house of houses) {
          scanned++;
          const labels = (house.labels ?? {}) as Record<string, unknown>;
          const winner = selectWinningRule(matchRulesForHouse(rules, labels));
          if (!winner) continue;
          matched++;

          const familyKey = `${house.communityId ?? ''}|${house.houseName ?? house.houseId}`;
          if (familySeen.has(familyKey)) {
            // 同家庭去重不产生触达，不单独占用原因码（ARCH §8 闸门4）
            continue;
          }

          const result = await this.guard.check(
            {
              houseId: house.houseId,
              customerKeyHash: house.customerKeyHash,
              hasMobile: !!house.contactMobileEnc,
              packageId: winner.packageId,
              now,
              leadGateActive: report.leadGateState === 'active',
              todaySentGlobal,
            },
            freq,
            windows,
            suppression,
          );

          if (!result.pass && !result.deferred) {
            suppressed++;
            await this.prisma.pushDetail.create({
              data: {
                pushTaskId: pushTask.id,
                houseId: house.houseId,
                packageId: winner.packageId,
                ruleId: winner.ruleId,
                posterTemplateId: posterByPkg.get(winner.packageId) ?? null,
                contactMobileEnc: house.contactMobileEnc,
                customerKeyHash: house.customerKeyHash,
                status: 'suppressed',
                reasonCode: result.reasonCode,
              },
            });
            continue;
          }

          if (result.deferred) {
            deferredCnt++;
            await this.prisma.pushDetail.create({
              data: {
                pushTaskId: pushTask.id,
                houseId: house.houseId,
                packageId: winner.packageId,
                ruleId: winner.ruleId,
                posterTemplateId: posterByPkg.get(winner.packageId) ?? null,
                contactMobileEnc: house.contactMobileEnc,
                customerKeyHash: house.customerKeyHash,
                status: 'deferred',
                reasonCode: result.reasonCode,
                deferredUntil: result.deferredUntil ? shanghaiCalendarDay(result.deferredUntil) : null,
              },
            });
            continue;
          }

          familySeen.add(familyKey);
          queued++;
          todaySentGlobal++;
          await this.prisma.pushDetail.create({
            data: {
              pushTaskId: pushTask.id,
              houseId: house.houseId,
              packageId: winner.packageId,
              ruleId: winner.ruleId,
              posterTemplateId: posterByPkg.get(winner.packageId) ?? null,
              contactMobileEnc: house.contactMobileEnc,
              customerKeyHash: house.customerKeyHash,
              status: 'queued',
            },
          });
        }

        cursor = houses[houses.length - 1].houseId;
        if (houses.length < this.SCAN_BATCH) break;
      }

      // 发送步骤：号码覆盖率门槛未达标时只生成清单不发送（DATA-CONTRACT GAP-1）
      const sendEnabled = report.mobileReady;
      let successCount = 0;
      let failedCount = 0;
      let taskStatus = 'done';

      if (sendEnabled) {
        const queuedDetails = await this.prisma.pushDetail.findMany({
          where: { pushTaskId: pushTask.id, status: 'queued' },
        });
        for (const d of queuedDetails) {
          const r = await this.channel.send({
            houseId: d.houseId,
            mobileEnc: d.contactMobileEnc,
            packageId: d.packageId,
            msgType: d.msgType,
          });
          if (r.ok) {
            successCount++;
            await this.prisma.pushDetail.update({
              where: { id: d.id },
              data: { status: 'sent', sentAt: new Date(), channelMsgId: r.channelMsgId },
            });
          } else {
            failedCount++;
            await this.prisma.pushDetail.update({
              where: { id: d.id },
              data: { status: 'failed', failReason: r.failReason },
            });
          }
        }
        await this.prisma.dailySendCounter.upsert({
          where: { statDate: day },
          create: { statDate: day, sentCount: successCount },
          update: { sentCount: { increment: successCount } },
        });
        taskStatus = failedCount > 0 && successCount === 0 ? 'failed' : failedCount > 0 ? 'partial' : 'done';
      }

      await this.prisma.pushTask.update({
        where: { id: pushTask.id },
        data: { totalCount: queued + suppressed + deferredCnt, successCount, failedCount, status: sendEnabled ? taskStatus : 'queued' },
      });
      await this.prisma.campaignTask.update({
        where: { id: task.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          scannedCount: scanned,
          matchedCount: matched,
          suppressedCount: suppressed + deferredCnt,
          queuedCount: queued,
          leadGateState: report.leadGateState,
          errorMessage: sendEnabled
            ? undefined
            : `号码覆盖率 ${(report.mobileCoverage ?? 0).toFixed(2)} 未达 0.70，已生成清单但暂停发送（GAP-1）；线索闸门=${report.leadGateState}`,
        },
      });

      this.logger.log(
        `跑批完成：扫描 ${scanned}，命中 ${matched}，拦截/顺延 ${suppressed + deferredCnt}，入队 ${queued}，发送成功 ${successCount}`,
      );
      return { campaignTaskId: task.id.toString(), status: 'success' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.campaignTask.update({
        where: { id: task.id },
        data: { status: 'failed', finishedAt: new Date(), errorMessage: message },
      });
      this.logger.error(`跑批失败：${message}`);
      throw err;
    }
  }
}
