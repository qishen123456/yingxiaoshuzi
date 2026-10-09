import { Module } from '@nestjs/common';
import { AttributionService } from './attribution.service';
import { AttributionController } from './attribution.controller';

@Module({
  controllers: [AttributionController],
  providers: [AttributionService],
  exports: [AttributionService],
})
export class AttributionModule {}
