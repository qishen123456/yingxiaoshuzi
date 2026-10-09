import { Module } from '@nestjs/common';
import { PushRecordsService } from './push-records.service';
import { PushRecordsController } from './push-records.controller';
import { ChannelAdapter } from '../../adapters/channel.adapter';

@Module({
  controllers: [PushRecordsController],
  providers: [PushRecordsService, ChannelAdapter],
})
export class PushRecordsModule {}
