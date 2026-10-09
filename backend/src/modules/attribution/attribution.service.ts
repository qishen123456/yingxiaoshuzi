import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { shanghaiCalendarDay } from '../../common/time.util';

/**
 * T+1 归因回填（ARCHITECTURE §9）。
 * 窗口 15 天；首触（窗口内最早 sent 推送）+ 末触（最接近线索创建的 sent 推送）双口径同时落库。
 * 线索无 external 包时，用首触推送的包补记为 inferred（不覆盖 external）。
 * 只处理 mobile_hash 键；house_only/unmatched 不参与消息归因（没有可关联的消息触达）。
 */
const ATTRIBUTION_WINDOW_DAYS = 15;
const BATCH = 2000;

@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(now: Date = new Date()) {
    const today = shanghaiCalendarDay(now);
    // 每日一条运行记录（stat_date 唯一）；重跑覆盖当日记录
    const run = await this.prisma.leadAttributionRun.upsert({
      where: { statDate: today },
      create: { statDate: today, windowDays: ATTRIBUTION_WINDOW_DAYS, status: 'running', startedAt: new Date() },
      update: { windowDays: ATTRIBUTION_WINDOW_DAYS, status: 'running', startedAt: new Date(), finishedAt: null, errorMessage: null },
    });

    try {
      let processed = 0;
      let attributed = 0;
      let inferredPackages = 0;
      const touchedPushIds = new Set<bigint>();

      for (;;) {
        const leads = await this.prisma.leadRecord.findMany({
          where: { attributedAt: null, customerKeyType: 'mobile_hash', staleInSource: false },
          take: BATCH,
          orderBy: { id: 'asc' },
        });
        if (leads.length === 0) break;

        for (const lead of leads) {
          processed++;
          const winEnd = lead.leadCreatedAt;
          const winStart = new Date(winEnd.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000);

          const touches = await this.prisma.pushDetail.findMany({
            where: {
              customerKeyHash: lead.customerKey,
              status: 'sent',
              sentAt: { gte: winStart, lte: winEnd },
            },
            orderBy: { sentAt: 'asc' },
            select: { id: true, packageId: true },
          });

          if (touches.length === 0) continue;

          const first = touches[0];
          const last = touches[touches.length - 1];
          const inferPackage = lead.packageSource === 'none' && first.packageId;
          if (inferPackage) inferredPackages++;

          await this.prisma.leadRecord.update({
            where: { id: lead.id },
            data: {
              firstTouchPushId: first.id,
              lastTouchPushId: last.id,
              attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
              attributedAt: now,
              // external 归因优先；无 external 包时用首触推送补 inferred（后续 merge 不覆盖归因字段）
              ...(inferPackage
                ? { productPackageId: first.packageId, packageSource: 'inferred' as const }
                : {}),
            },
          });
          attributed++;
          touchedPushIds.add(first.id);
          touchedPushIds.add(last.id);
        }

        if (leads.length < BATCH) break;
      }

      // 重算受影响推送的线索数（首触/末触双口径引用数之和）
      for (const pushId of touchedPushIds) {
        const [firstCnt, lastCnt] = await Promise.all([
          this.prisma.leadRecord.count({ where: { firstTouchPushId: pushId } }),
          this.prisma.leadRecord.count({ where: { lastTouchPushId: pushId } }),
        ]);
        await this.prisma.pushDetail.update({
          where: { id: pushId },
          data: { leadCount: firstCnt + lastCnt },
        });
      }

      await this.prisma.leadAttributionRun.update({
        where: { id: run.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          leadScanned: processed,
          attributed,
          unattributed: processed - attributed,
        },
      });
      this.logger.log(`归因完成：扫描 ${processed}，归因 ${attributed}，inferred 补包 ${inferredPackages}`);
      return { runId: run.id.toString(), processed, attributed, inferredPackages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.leadAttributionRun.update({
        where: { id: run.id },
        data: { status: 'failed', finishedAt: new Date(), errorMessage: message },
      });
      throw err;
    }
  }
}
