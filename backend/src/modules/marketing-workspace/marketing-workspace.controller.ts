import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MarketingWorkspaceService } from './marketing-workspace.service';

@Controller()
export class MarketingWorkspaceController {
  constructor(private readonly service:MarketingWorkspaceService){}
  @Get('audience-packages') listAudiencePackages(){return this.service.listAudiencePackages();}
  @Post('audience-packages') createAudiencePackage(@Body() body:{name?:string;criteria?:string;houseIds?:string[]}){return this.service.createAudiencePackage(body);}
  @Get('audience-packages/:id') getAudiencePackage(@Param('id') id:string){return this.service.getAudiencePackage(id);}
  @Get('marketing-push-batches') listBatches(@Query('q') q?:string){return this.service.listMarketingPushBatches(q);}
  @Post('marketing-push-batches') createBatch(@Body() body:{audiencePackageId?:string|null;packageName?:string;sender?:string;contentSnapshot?:string;posterName?:string;posterData?:string;channels?:string[];criteria?:string;houseIds?:string[]}){return this.service.createMarketingPushBatch(body);}
  @Get('marketing-push-batches/:id') getBatch(@Param('id') id:string){return this.service.getMarketingPushBatch(id);}
  @Get('poster-templates') listPosters(){return this.service.listPosterTemplates();}
  @Post('poster-templates') createPoster(@Body() body:{name?:string;packageId?:string|null;width?:number;height?:number;previewData?:string;svgSpec?:unknown}){return this.service.createPosterTemplate(body);}
  @Patch('poster-templates/:id/status') setPosterStatus(@Param('id') id:string,@Body() body:{status?:string}){return this.service.setPosterTemplateStatus(id,body.status);}
}
