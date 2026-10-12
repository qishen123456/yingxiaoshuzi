import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { SyncModule } from './modules/sync/sync.module';
import { FrequencyModule } from './modules/frequency/frequency.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { RulesModule } from './modules/rules/rules.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { PushRecordsModule } from './modules/push-records/push-records.module';
import { AttributionModule } from './modules/attribution/attribution.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DailyJob } from './jobs/daily.job';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SyncModule,
    FrequencyModule,
    CatalogModule,
    RulesModule,
    CampaignsModule,
    PushRecordsModule,
    AttributionModule,
    AnalyticsModule,
  ],
  providers: [DailyJob],
})
export class AppModule {}
