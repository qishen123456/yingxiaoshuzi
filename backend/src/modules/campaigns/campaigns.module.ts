import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { FrequencyModule } from '../frequency/frequency.module';
import { ChannelAdapter } from '../../adapters/channel.adapter';
import { CampaignRunnerService } from './campaign-runner.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [SyncModule, FrequencyModule],
  controllers: [CampaignsController],
  providers: [CampaignRunnerService, ChannelAdapter],
  exports: [CampaignRunnerService, ChannelAdapter],
})
export class CampaignsModule {}
