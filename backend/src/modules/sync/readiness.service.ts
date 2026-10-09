import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { shanghaiCalendarDay } from '../../common/time.util';

/**
 * 跑批前置就绪校验（DATA-CONTRACT §1）。
 * 两源独立：标签/号码问题与线索问题互不阻塞对方链路，但决定跑批能走到哪一步。
 */
export interface ReadinessReport {
  labelReady: boolean;
  labelStatDate: Date | null;
  leadReady: boolean;
  leadSyncedAt: Date | null;
  leadLagDays: number | null;
  mobileCoverage: number | null; // 0~1
  mobileReady: boolean; // 覆盖率 >= 0.70
  totalHouses: number;
  mobileHouses: number;
  /** 线索闸门状态：active 正常；bypassed_open 数据过期 fail-open；unavailable 无数据 */
  leadGateState: 'active' | 'bypassed_open' | 'unavailable';
}

const LEAD_STALE_DAYS = 2;
const MOBILE_COVERAGE_THRESHOLD = 0.7;

@Injectable()
export class ReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async check(now: Date = new Date()): Promise<ReadinessReport> {
    // date 列以「上海自然日」UTC 午夜存储，比较口径必须一致（不能用本地午夜）
    const today = shanghaiCalendarDay(now);

    const [latestLabel, latestLead, totalHouses, mobileHouses] = await Promise.all([
      this.prisma.houseLabelSnapshot.findFirst({ orderBy: { statDate: 'desc' }, select: { statDate: true } }),
      this.prisma.leadRecord.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
      this.prisma.houseLabelSnapshot.count(),
      this.prisma.houseLabelSnapshot.count({ where: { NOT: { contactMobileEnc: null } } }),
    ]);

    const labelStatDate = latestLabel?.statDate ?? null;
    const labelReady = !!labelStatDate && labelStatDate.getTime() >= today.getTime();

    const leadSyncedAt = latestLead?.syncedAt ?? null;
    let leadLagDays: number | null = null;
    let leadGateState: ReadinessReport['leadGateState'] = 'unavailable';
    let leadReady = false;
    if (leadSyncedAt) {
      leadLagDays = Math.floor((now.getTime() - leadSyncedAt.getTime()) / 86_400_000);
      leadReady = leadLagDays <= LEAD_STALE_DAYS;
      leadGateState = leadReady ? 'active' : 'bypassed_open';
    }

    const mobileCoverage = totalHouses > 0 ? mobileHouses / totalHouses : null;
    const mobileReady = mobileCoverage !== null && mobileCoverage >= MOBILE_COVERAGE_THRESHOLD;

    return {
      labelReady,
      labelStatDate,
      leadReady,
      leadSyncedAt,
      leadLagDays,
      mobileCoverage,
      mobileReady,
      totalHouses,
      mobileHouses,
      leadGateState,
    };
  }
}
