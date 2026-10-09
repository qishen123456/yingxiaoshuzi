import { Controller, Get, Post } from '@nestjs/common';
import { HouseSyncService } from './house-sync.service';
import { LeadSyncService } from './lead-sync.service';
import { ReadinessService } from './readiness.service';

/**
 * 数据同步运维接口：
 * 生产环境 merge 由 DataWorks 同步完成后经调度触发；骨架期提供手动端点便于联调。
 */
@Controller('sync')
export class SyncController {
  constructor(
    private readonly houseSync: HouseSyncService,
    private readonly leadSync: LeadSyncService,
    private readonly readiness: ReadinessService,
  ) {}

  /** 就绪状态（跑批前置校验依据）。 */
  @Get('readiness')
  async getReadiness() {
    const r = await this.readiness.check();
    return {
      ...r,
      labelStatDate: r.labelStatDate?.toISOString().slice(0, 10) ?? null,
      leadSyncedAt: r.leadSyncedAt?.toISOString() ?? null,
      mobileCoverage: r.mobileCoverage === null ? null : Number(r.mobileCoverage.toFixed(4)),
    };
  }

  /** 节点① 标签 staging -> snapshot。 */
  @Post('merge/house-labels')
  mergeHouseLabels() {
    return this.houseSync.mergeHouseLabels();
  }

  /** 节点①b 补号 staging -> resolve + 回填快照 + 清明文。 */
  @Post('merge/mobiles')
  mergeMobiles() {
    return this.houseSync.mergeMobiles();
  }

  /** 节点② 线索 staging -> lead_record + 清明文。 */
  @Post('merge/leads')
  mergeLeads() {
    return this.leadSync.mergeLeads();
  }
}
