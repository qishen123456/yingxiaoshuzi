import { Module } from '@nestjs/common';
import { FrequencyGuard } from './frequency.guard';
import { FrequencyController } from './frequency.controller';

@Module({
  controllers: [FrequencyController],
  providers: [FrequencyGuard],
  exports: [FrequencyGuard],
})
export class FrequencyModule {}
