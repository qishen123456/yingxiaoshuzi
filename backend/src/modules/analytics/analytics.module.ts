import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [SyncModule],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
