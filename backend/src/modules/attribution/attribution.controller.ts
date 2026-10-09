import { Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionService } from './attribution.service';

@Controller('attribution')
export class AttributionController {
  constructor(
    private readonly attribution: AttributionService,
    private readonly prisma: PrismaService,
  ) {}

  /** 手动触发归因回填（幂等：只处理 attributed_at 为空的线索）。 */
  @Post('run')
  run() {
    return this.attribution.run();
  }

  @Get('runs')
  runs() {
    return this.prisma.leadAttributionRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 });
  }
}
