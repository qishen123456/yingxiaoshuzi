import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReadinessService } from '../sync/readiness.service';

/** 运营看板：触达漏斗、线索质量与归因来源分布、数据就绪状态。 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get('overview')
  async overview() {
    const [pushByStatus, leadBySource, leadByQuality, leadTotal, attributedTotal] = await Promise.all([
      this.prisma.pushDetail.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.leadRecord.groupBy({ by: ['packageSource'], _count: { _all: true } }),
      this.prisma.leadRecord.groupBy({ by: ['leadQuality'], _count: { _all: true } }),
      this.prisma.leadRecord.count(),
      this.prisma.leadRecord.count({ where: { NOT: { attributedAt: null } } }),
    ]);

    return {
      readiness: await this.readiness.check(),
      push: Object.fromEntries(pushByStatus.map((r) => [r.status, r._count._all])),
      leads: {
        total: leadTotal,
        attributed: attributedTotal,
        bySource: Object.fromEntries(leadBySource.map((r) => [r.packageSource, r._count._all])),
        byQuality: Object.fromEntries(leadByQuality.map((r) => [r.leadQuality ?? 'unknown', r._count._all])),
      },
    };
  }
}
