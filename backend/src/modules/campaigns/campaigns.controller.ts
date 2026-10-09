import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CampaignRunnerService } from './campaign-runner.service';

/** 每日跑批：手动触发（P0）+ 定时触发（07:30，见 jobs/daily.job.ts）。 */
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly runner: CampaignRunnerService,
    private readonly prisma: PrismaService,
  ) {}

  /** 手动触发当日跑批（同日幂等：已跑则直接返回既有状态）。 */
  @Post('run')
  run(@Body() body?: { date?: string }) {
    const date = body?.date ? new Date(`${body.date}T00:00:00`) : new Date();
    return this.runner.run(date);
  }

  /** 跑批任务列表（最近 30 天）。 */
  @Get()
  async list() {
    const rows = await this.prisma.campaignTask.findMany({
      orderBy: { statDate: 'desc' },
      take: 30,
      include: { pushTasks: { select: { id: true, channel: true, status: true, totalCount: true, successCount: true } } },
    });
    return rows.map((t) => ({ ...t, id: t.id.toString() }));
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const t = await this.prisma.campaignTask.findUnique({
      where: { id: BigInt(id) },
      include: { pushTasks: true },
    });
    return t ? { ...t, id: t.id.toString() } : null;
  }
}
