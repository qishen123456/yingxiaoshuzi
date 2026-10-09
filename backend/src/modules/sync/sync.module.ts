import { Module } from '@nestjs/common';
import { HouseSyncService } from './house-sync.service';
import { LeadSyncService } from './lead-sync.service';
import { ReadinessService } from './readiness.service';
import { SyncController } from './sync.controller';

@Module({
  controllers: [SyncController],
  providers: [HouseSyncService, LeadSyncService, ReadinessService],
  exports: [HouseSyncService, LeadSyncService, ReadinessService],
})
export class SyncModule {}
