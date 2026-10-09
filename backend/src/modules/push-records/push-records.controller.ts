import { Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PushRecordsService } from './push-records.service';

@Controller('push-records')
export class PushRecordsController {
  constructor(private readonly service: PushRecordsService) {}

  @Get()
  list(
    @Query('taskId') taskId?: string,
    @Query('status') status?: string,
    @Query('reasonCode') reasonCode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.list({
      taskId: taskId ? BigInt(taskId) : undefined,
      status,
      reasonCode,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  /** 状态×原因码分组计数（跑批结果页漏斗与数据缺口看板数据源）。 */
  @Get('reasons/summary')
  reasonSummary(@Query('taskId') taskId?: string) {
    return this.service.reasonSummary(taskId ? BigInt(taskId) : undefined);
  }

  @Post(':id/halt')
  halt(@Param('id', ParseIntPipe) id: number) {
    return this.service.halt(BigInt(id));
  }

  @Post(':id/retry')
  retry(@Param('id', ParseIntPipe) id: number) {
    return this.service.retry(BigInt(id));
  }
}
