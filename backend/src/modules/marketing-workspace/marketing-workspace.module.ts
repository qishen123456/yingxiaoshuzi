import { Module } from '@nestjs/common';
import { HousesModule } from '../houses/houses.module';
import { MarketingWorkspaceController } from './marketing-workspace.controller';
import { MarketingWorkspaceService } from './marketing-workspace.service';
@Module({imports:[HousesModule],controllers:[MarketingWorkspaceController],providers:[MarketingWorkspaceService]})
export class MarketingWorkspaceModule {}
