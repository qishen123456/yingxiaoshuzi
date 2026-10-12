import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { HousesService } from '../houses/houses.service';

@Injectable()
export class MarketingWorkspaceService {
  constructor(private readonly prisma:PrismaService,private readonly houses:HousesService){}
  private async countUniquePhones(ids:string[]) {
    const rows=await this.prisma.houseLabelSnapshot.findMany({where:{houseId:{in:ids}},select:{houseId:true,customerKeyHash:true}});
    const keys=new Set<string>();rows.forEach(r=>keys.add(r.customerKeyHash||`house:${r.houseId}`));return keys.size;
  }
  async listAudiencePackages() {
    const rows=await this.prisma.audiencePackage.findMany({orderBy:{createdAt:'desc'},take:100,
      select:{id:true,name:true,criteria:true,createdBy:true,status:true,houseCount:true,uniquePhoneCount:true,createdAt:true}});
    return rows.map(r=>({...r,id:r.id.toString(),createdAt:r.createdAt.toISOString()}));
  }
  async createAudiencePackage(body:{name?:string;criteria?:string;houseIds?:string[]}) {
    const name=String(body.name??'').trim();const ids=Array.isArray(body.houseIds)?[...new Set(body.houseIds.map(String))]:[];
    if(!name)throw new BadRequestException('人群包名称不能为空');if(!ids.length)throw new BadRequestException('请至少选择一套房屋');if(ids.length>5000)throw new BadRequestException('单个人群包最多 5000 套房屋');
    const details=await this.houses.findByIds(ids);if(details.length!==ids.length)throw new BadRequestException('所选房屋已变化，请刷新列表后重新保存');
    const uniquePhoneCount=await this.countUniquePhones(ids);
    const row=await this.prisma.audiencePackage.create({data:{name,criteria:String(body.criteria??'').trim()||null,
      createdBy:'当前操作人（登录身份待接入）',status:'saved',houseCount:details.length,uniquePhoneCount,
      houses:{create:details.map(item=>({houseId:item.houseId,houseSnapshot:item as unknown as Prisma.InputJsonValue}))}},
      select:{id:true,name:true,criteria:true,createdBy:true,status:true,houseCount:true,uniquePhoneCount:true,createdAt:true}});
    return {...row,id:row.id.toString(),createdAt:row.createdAt.toISOString()};
  }
  async getAudiencePackage(id:string) {
    let key:bigint;try{key=BigInt(id)}catch{throw new BadRequestException('人群包编号无效')}
    const row=await this.prisma.audiencePackage.findUnique({where:{id:key},include:{houses:{orderBy:{id:'asc'}}}});
    if(!row)throw new NotFoundException('人群包不存在');
    return {id:row.id.toString(),name:row.name,criteria:row.criteria,createdBy:row.createdBy,status:row.status,
      houseCount:row.houseCount,uniquePhoneCount:row.uniquePhoneCount,createdAt:row.createdAt.toISOString(),
      houses:row.houses.map(h=>h.houseSnapshot),houseIds:row.houses.map(h=>h.houseId)};
  }
  async listMarketingPushBatches(q?:string) {
    const term=q?.trim();
    const rows=await this.prisma.marketingPushBatch.findMany({where:term?{OR:[
      {packageName:{contains:term,mode:'insensitive'}},{sender:{contains:term,mode:'insensitive'}},{contentSnapshot:{contains:term,mode:'insensitive'}}
    ]}:{},orderBy:{createdAt:'desc'},take:100,select:{id:true,audiencePackageId:true,packageName:true,sender:true,channels:true,criteria:true,
      houseCount:true,uniquePhoneCount:true,posterName:true,status:true,createdAt:true}});
    return rows.map(r=>({...r,id:r.id.toString(),audiencePackageId:r.audiencePackageId?.toString()??null,
      channels:Array.isArray(r.channels)?r.channels:[],createdAt:r.createdAt.toISOString()}));
  }
  async createMarketingPushBatch(body:{audiencePackageId?:string|null;packageName?:string;sender?:string;contentSnapshot?:string;posterName?:string;posterData?:string;channels?:string[];criteria?:string;houseIds?:string[]}) {
    const packageName=String(body.packageName??'').trim(),content=String(body.contentSnapshot??'').trim();
    const channels=Array.isArray(body.channels)?[...new Set(body.channels.map(v=>String(v).trim()).filter(Boolean))]:[];
    const ids=Array.isArray(body.houseIds)?[...new Set(body.houseIds.map(String))]:[];
    const posterData=String(body.posterData??'');
    if(!packageName)throw new BadRequestException('推送人群包名称不能为空');if(!content)throw new BadRequestException('推送文案不能为空');
    if(!ids.length)throw new BadRequestException('推送目标不能为空');if(ids.length>5000)throw new BadRequestException('单个批次最多 5000 套房屋');
    if(!channels.length)throw new BadRequestException('至少选择一个触达渠道');if(posterData.length>2000000)throw new BadRequestException('压缩后的海报过大');
    const details=await this.houses.findByIds(ids);if(details.length!==ids.length)throw new BadRequestException('部分房屋已不在当前快照中，请刷新后重试');
    const uniquePhoneCount=await this.countUniquePhones(ids);let audiencePackageId:bigint|null=null;
    if(body.audiencePackageId){try{audiencePackageId=BigInt(body.audiencePackageId)}catch{throw new BadRequestException('人群包编号无效')}
      const exists=await this.prisma.audiencePackage.findUnique({where:{id:audiencePackageId},select:{id:true}});if(!exists)throw new BadRequestException('关联的人群包不存在')}
    const row=await this.prisma.marketingPushBatch.create({data:{audiencePackageId,packageName,sender:String(body.sender??'当前操作人（登录身份待接入）'),
      contentSnapshot:content,posterName:String(body.posterName??'').trim()||null,posterData:posterData||null,channels:channels as Prisma.InputJsonValue,
      criteria:String(body.criteria??'').trim()||null,houseCount:details.length,uniquePhoneCount,status:'recorded_demo',
      houses:{create:details.map(item=>({houseId:item.houseId,houseSnapshot:item as unknown as Prisma.InputJsonValue}))}},
      select:{id:true,packageName:true,sender:true,channels:true,criteria:true,houseCount:true,uniquePhoneCount:true,posterName:true,status:true,createdAt:true}});
    return {...row,id:row.id.toString(),channels,createdAt:row.createdAt.toISOString(),message:'推送批次已保存，当前未调用真实短信/企微通道。'};
  }
  async getMarketingPushBatch(id:string) {
    let key:bigint;try{key=BigInt(id)}catch{throw new BadRequestException('批次编号无效')}
    const row=await this.prisma.marketingPushBatch.findUnique({where:{id:key},include:{houses:{orderBy:{id:'asc'}}}});
    if(!row)throw new NotFoundException('推送批次不存在');
    return {id:row.id.toString(),audiencePackageId:row.audiencePackageId?.toString()??null,packageName:row.packageName,sender:row.sender,
      contentSnapshot:row.contentSnapshot,posterName:row.posterName,posterData:row.posterData,channels:Array.isArray(row.channels)?row.channels:[],
      criteria:row.criteria,houseCount:row.houseCount,uniquePhoneCount:row.uniquePhoneCount,status:row.status,createdAt:row.createdAt.toISOString(),
      houses:row.houses.map(h=>h.houseSnapshot)};
  }
  async listPosterTemplates() {
    const rows=await this.prisma.posterTemplate.findMany({orderBy:{id:'desc'},take:100,include:{package:{select:{id:true,code:true,name:true}}}});
    return rows.map(r=>({id:r.id.toString(),name:r.name,packageId:r.packageId?.toString()??null,package:r.package?{...r.package,id:r.package.id.toString()}:null,
      width:r.width,height:r.height,backgroundOssKey:r.backgroundOssKey,previewData:r.previewData,svgSpec:r.svgSpec,status:r.status}));
  }
  async createPosterTemplate(body:{name?:string;packageId?:string|null;width?:number;height?:number;previewData?:string;svgSpec?:unknown}) {
    const name=String(body.name??'').trim(),previewData=String(body.previewData??'');
    if(!name)throw new BadRequestException('海报模板名称不能为空');if(previewData.length>2000000)throw new BadRequestException('图片压缩后仍过大');
    let packageId:bigint|null=null;if(body.packageId){try{packageId=BigInt(body.packageId)}catch{throw new BadRequestException('产品包编号无效')}}
    const width=Math.min(2400,Math.max(100,Number(body.width)||750)),height=Math.min(3200,Math.max(100,Number(body.height)||1600));
    const svgSpec=(body.svgSpec??{canvas:{width,height},slots:{}}) as Prisma.InputJsonValue;
    const row=await this.prisma.posterTemplate.create({data:{name,packageId,width,height,previewData:previewData||null,svgSpec,status:'draft'},
      select:{id:true,name:true,packageId:true,width:true,height:true,previewData:true,svgSpec:true,status:true}});
    return {...row,id:row.id.toString(),packageId:row.packageId?.toString()??null};
  }
  async setPosterTemplateStatus(id:string,status?:string) {
    let key:bigint;try{key=BigInt(id)}catch{throw new BadRequestException('模板编号无效')}
    if(!['draft','published','disabled'].includes(String(status)))throw new BadRequestException('模板状态无效');
    const row=await this.prisma.posterTemplate.update({where:{id:key},data:{status},select:{id:true,name:true,status:true}});
    return {...row,id:row.id.toString()};
  }
}
