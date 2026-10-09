import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isInBlockedWindow,
  isInSendWindows,
  nextWindowStart,
  startOfDay,
  daysAgo,
  toTimeWindow,
  type TimeWindow,
} from '../../common/time.util';

/**
 * 频控闸门链（ARCHITECTURE §8）。
 * 顺序：0a 线索同包 -> 0b 线索客户级 -> 0c 无号码 -> 1 退订 -> 2 黑名单
 *       -> 5 房屋冷却 -> 6 产品包冷却 -> 7 日/周/月上限 -> 8 全局上限
 *       -> 9 可发送时段 -> 10 禁发时段（11 节假日 holiday_skip=false 一期跳过）。
 * 任一不过短路返回原因码；闸门 4（同家庭去重）在 runner 批次内存中处理。
 */

export type ReasonCode =
  | 'LEAD_PACKAGE_COOLDOWN'
  | 'LEAD_HOUSE_COOLDOWN'
  | 'NO_MOBILE'
  | 'OPT_OUT'
  | 'BLACKLIST'
  | 'HOUSE_COOLDOWN'
  | 'PACKAGE_COOLDOWN'
  | 'HOUSE_DAILY_CAP'
  | 'HOUSE_WEEKLY_CAP'
  | 'HOUSE_MONTHLY_CAP'
  | 'GLOBAL_CAP_DEFERRED'
  | 'OUT_OF_WINDOW'
  | 'BLOCKED_WINDOW'
  | 'HOLIDAY_SKIP';

export interface GuardInput {
  houseId: string;
  customerKeyHash: string | null;
  hasMobile: boolean;
  packageId: bigint;
  now: Date;
  leadGateActive: boolean; // false = 线索数据缺失/过期，按 fail-open 跳过 0a/0b（任务已告警标注）
  todaySentGlobal: number; // 当日已发送（含本批前序）
}

export interface GuardResult {
  pass: boolean;
  reasonCode?: ReasonCode;
  deferred?: boolean; // true = 顺延（不是失败也不是频控拦截）
  deferredUntil?: Date;
}

@Injectable()
export class FrequencyGuard {
  constructor(private readonly prisma: PrismaService) {}

  /** 加载全局频控规则与其可发送时段（跑批开始时加载一次）。 */
  async loadGlobalRule() {
    const rule = await this.prisma.pushFrequencyRule.findFirst({
      where: { scopeType: 'global', status: 'enabled' },
      include: { windows: true },
    });
    if (!rule) throw new Error('全局频控规则未初始化，请先执行 sql/04_frequency_seed.sql');
    const windows = toTimeWindow(rule.windows);
    return { rule, windows };
  }

  async check(
    input: GuardInput,
    rule: {
      houseCooldownDays: number;
      packageCooldownDays: number;
      houseDailyCap: number;
      houseWeeklyCap: number;
      houseMonthlyCap: number;
      globalDailyCap: number;
      leadPackageCooldownDays: number;
      leadHouseCooldownDays: number;
    },
    windows: TimeWindow[],
    suppression: { optOutKeys: Set<string>; blacklistKeys: Set<string> },
  ): Promise<GuardResult> {
    const blocked = (reasonCode: ReasonCode): GuardResult => ({ pass: false, reasonCode });
    const deferred = (reasonCode: ReasonCode, until: Date): GuardResult => ({
      pass: false,
      reasonCode,
      deferred: true,
      deferredUntil: until,
    });

    // ---------- 闸门 0a/0b：线索静默（数据不可用时 fail-open，由 runner 保证已告警） ----------
    if (input.leadGateActive && input.customerKeyHash) {
      const pkgLead = await this.prisma.leadRecord.findFirst({
        where: {
          customerKey: input.customerKeyHash,
          productPackageId: input.packageId,
          packageSource: { in: ['external', 'inferred'] },
          leadCreatedAt: { gte: daysAgo(rule.leadPackageCooldownDays, input.now) },
        },
        select: { id: true },
      });
      if (pkgLead) return blocked('LEAD_PACKAGE_COOLDOWN');

      const anyLead = await this.prisma.leadRecord.findFirst({
        where: {
          customerKey: input.customerKeyHash,
          leadCreatedAt: { gte: daysAgo(rule.leadHouseCooldownDays, input.now) },
        },
        select: { id: true },
      });
      if (anyLead) return blocked('LEAD_HOUSE_COOLDOWN');
    }

    // ---------- 闸门 0c：无号码（数据缺口，非打扰风险；重推同样不可越） ----------
    if (!input.hasMobile) return blocked('NO_MOBILE');

    // ---------- 闸门 1/2：退订/黑名单（号码 HMAC 与房屋双键都查） ----------
    const keys = [input.houseId, input.customerKeyHash].filter(Boolean) as string[];
    if (keys.some((k) => suppression.optOutKeys.has(k))) return blocked('OPT_OUT');
    if (keys.some((k) => suppression.blacklistKeys.has(k))) return blocked('BLACKLIST');

    // ---------- 闸门 5：房屋冷却（任意包，近 houseCooldownDays） ----------
    const houseRecent = await this.prisma.pushDetail.findFirst({
      where: {
        houseId: input.houseId,
        msgType: 'marketing',
        status: { in: ['sent', 'queued', 'deferred'] },
        createdAt: { gte: daysAgo(rule.houseCooldownDays, input.now) },
      },
      select: { id: true },
    });
    if (houseRecent) return blocked('HOUSE_COOLDOWN');

    // ---------- 闸门 6：产品包冷却 ----------
    const pkgRecent = await this.prisma.pushDetail.findFirst({
      where: {
        houseId: input.houseId,
        packageId: input.packageId,
        msgType: 'marketing',
        status: { in: ['sent', 'queued', 'deferred'] },
        createdAt: { gte: daysAgo(rule.packageCooldownDays, input.now) },
      },
      select: { id: true },
    });
    if (pkgRecent) return blocked('PACKAGE_COOLDOWN');

    // ---------- 闸门 7：房屋日/周/月上限（跨渠道合并计数，锚点是房屋） ----------
    const capCount = (since: Date) =>
      this.prisma.pushDetail.count({
        where: {
          houseId: input.houseId,
          msgType: 'marketing',
          status: { in: ['sent', 'queued'] },
          createdAt: { gte: since },
        },
      });
    if ((await capCount(startOfDay(input.now))) >= rule.houseDailyCap) return blocked('HOUSE_DAILY_CAP');
    if ((await capCount(daysAgo(7, input.now))) >= rule.houseWeeklyCap) return blocked('HOUSE_WEEKLY_CAP');
    if ((await capCount(daysAgo(30, input.now))) >= rule.houseMonthlyCap) return blocked('HOUSE_MONTHLY_CAP');

    // ---------- 闸门 8：全局日上限（超限顺延次日首窗口） ----------
    if (input.todaySentGlobal >= rule.globalDailyCap) {
      return deferred('GLOBAL_CAP_DEFERRED', nextWindowStart(input.now, windows));
    }

    // ---------- 闸门 10：禁发时段（硬规则，优先于可发送窗口判定） ----------
    if (isInBlockedWindow(input.now)) return blocked('BLOCKED_WINDOW');

    // ---------- 闸门 9：可发送时段（窗口外顺延下一窗口） ----------
    if (!isInSendWindows(input.now, windows)) {
      return deferred('OUT_OF_WINDOW', nextWindowStart(input.now, windows));
    }

    return { pass: true };
  }
}
