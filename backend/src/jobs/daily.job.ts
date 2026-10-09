import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CampaignRunnerService } from '../modules/campaigns/campaign-runner.service';
import { AttributionService } from '../modules/attribution/attribution.service';

/**
 * 每日定时编排（容器 TZ=Asia/Shanghai）：
 * 07:30 跑批（上游同步 02:00/02:10/02:30 完成后）；
 * 09:10 归因回填（T+1 线索与回执均已落库）。
 * runner 自身按 stat_date 幂等，定时触发与手动触发不会重复执行。
 */
@Injectable()
export class DailyJob {
  private readonly logger = new Logger(DailyJob.name);

  constructor(
    private readonly runner: CampaignRunnerService,
    private readonly attribution: AttributionService,
  ) {}

  @Cron('0 30 7 * * *', { name: 'daily-campaign', timeZone: 'Asia/Shanghai' })
  async dailyCampaign() {
    this.logger.log('定时触发：每日跑批 07:30');
    try {
      await this.runner.run();
    } catch (err) {
      this.logger.error(`定时跑批失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  @Cron('0 10 9 * * *', { name: 'daily-attribution', timeZone: 'Asia/Shanghai' })
  async dailyAttribution() {
    this.logger.log('定时触发：归因回填 09:10');
    try {
      await this.attribution.run();
    } catch (err) {
      this.logger.error(`定时归因失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
