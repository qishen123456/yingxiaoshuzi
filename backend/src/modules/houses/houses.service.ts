import { Injectable } from '@nestjs/common';
import { Prisma, type HouseLabelSnapshot } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { matchRulesForHouse, selectWinningRule, type HouseLabels, type RuleMatchInput } from '../../engine/rule-engine';

export interface HouseSearchQuery {
  city?: string; communityId?: string; q?: string; tagKey?: string; tagValue?: string;
  packageId?: string; houseIds?: string; page?: string; pageSize?: string;
}
type PackageInfo = { id: string; code: string; name: string };
type MatchRow = { house: HouseLabelSnapshot; labels: HouseLabels; matchedProducts: PackageInfo[]; winningPackage: PackageInfo | null; winningRuleId: string | null };
export type HouseListItem = {
  houseId:string; houseName:string|null; communityId:string|null; communityName:string|null; city:string|null; region:string|null;
  ownerNameMasked:string|null; mobileMasked:string|null; hasMobile:boolean; statDate:string; syncedAt:string;
  labels:HouseLabels; matchedProducts:PackageInfo[]; winningPackage:PackageInfo|null; winningRuleId:string|null;
  leadCount:number; openLeadCount:number; lastPushAt:string|null; lastPushStatus:string|null;
};

@Injectable()
export class HousesService {
  private readonly maxScan=20000;
  private readonly batchSize=1000;
  constructor(private readonly prisma:PrismaService) {}

  private baseWhere(q:HouseSearchQuery):Prisma.HouseLabelSnapshotWhereInput {
    const where:Prisma.HouseLabelSnapshotWhereInput={};
    if(q.city) where.city=q.city;
    if(q.communityId) where.communityId=q.communityId;
    const ids=q.houseIds?.split(',').map(x=>x.trim()).filter(Boolean);
    if(ids?.length) where.houseId={in:ids.slice(0,5000)};
    const term=q.q?.trim();
    if(term) where.OR=[
      {houseId:{contains:term,mode:'insensitive'}},
      {houseName:{contains:term,mode:'insensitive'}},
      {communityName:{contains:term,mode:'insensitive'}},
      {ownerNameMasked:{contains:term,mode:'insensitive'}},
    ];
    return where;
  }
  private async getRules() {
    const rows=await this.prisma.mappingRule.findMany({
      where:{status:'enabled'},orderBy:[{priority:'asc'},{id:'asc'}],
      include:{package:{select:{id:true,code:true,name:true}}},
    });
    const inputs:RuleMatchInput[]=rows.map(r=>({id:r.id,packageId:r.packageId,priority:r.priority,mutexGroupId:r.mutexGroupId,conditionJson:r.conditionJson,status:r.status}));
    const packageInfo = (row: (typeof rows)[number]): PackageInfo => ({ id: row.package.id.toString(), code: row.package.code, name: row.package.name });
    const byRuleId = new Map(rows.map(r => [r.id.toString(), packageInfo(r)]));
    const byPackageId = new Map(rows.map(r => [r.package.id.toString(), packageInfo(r)]));
    return { inputs, byRuleId, byPackageId };
  }
  private tagMatches(labels:HouseLabels,key?:string,value?:string) {
    if(!key) return true;
    const actual=labels[key];
    if(value===undefined||value==='') return actual!==undefined&&actual!==null&&!(Array.isArray(actual)&&actual.length===0);
    if(Array.isArray(actual)) return actual.map(String).includes(value);
    return String(actual??'')===value;
  }
  private async matchHouses(houses:HouseLabelSnapshot[],query:HouseSearchQuery,rules:Awaited<ReturnType<HousesService['getRules']>>):Promise<MatchRow[]> {
    const out:MatchRow[]=[];
    for(const house of houses) {
      const labels=(house.labels??{}) as HouseLabels;
      if(!this.tagMatches(labels,query.tagKey,query.tagValue)) continue;
      const matches=matchRulesForHouse(rules.inputs,labels);
      const winner=selectWinningRule(matches);
      if(query.packageId==='none'&&winner) continue;
      if(query.packageId&&query.packageId!=='none'&&winner?.packageId.toString()!==query.packageId) continue;
      const products:PackageInfo[]=[]; const seen=new Set<string>();
      for(const match of matches) {
        const info=rules.byRuleId.get(match.ruleId.toString());
        if(info&&!seen.has(info.id)){products.push(info);seen.add(info.id);}
      }
      out.push({house,labels,matchedProducts:products,winningPackage:winner?rules.byPackageId.get(winner.packageId.toString())??null:null,winningRuleId:winner?.ruleId.toString()??null});
    }
    return out;
  }
  private async enrich(rows:MatchRow[]):Promise<HouseListItem[]> {
    if(!rows.length) return [];
    const ids=rows.map(r=>r.house.houseId);
    const [mobileRows,leadRows,pushRows]=await Promise.all([
      this.prisma.houseMobileResolve.findMany({where:{houseId:{in:ids}},orderBy:[{isPreferred:'desc'},{resolvedAt:'desc'}],select:{houseId:true,mobileMasked:true}}),
      this.prisma.leadRecord.groupBy({by:['houseId'],where:{houseId:{in:ids}},_count:{_all:true}}),
      this.prisma.pushDetail.findMany({where:{houseId:{in:ids}},orderBy:{createdAt:'desc'},select:{houseId:true,createdAt:true,status:true}}),
    ]);
    const mobiles=new Map<string,string>();for(const r of mobileRows)if(!mobiles.has(r.houseId))mobiles.set(r.houseId,r.mobileMasked);
    const leads=new Map<string,number>();for(const r of leadRows)if(r.houseId)leads.set(r.houseId,r._count._all);
    const pushes=new Map<string,{at:Date;status:string}>();for(const r of pushRows)if(!pushes.has(r.houseId))pushes.set(r.houseId,{at:r.createdAt,status:r.status});
    return rows.map(({house,labels,matchedProducts,winningPackage,winningRuleId})=>{
      const latest=pushes.get(house.houseId);const mobile=mobiles.get(house.houseId)??null;
      return {houseId:house.houseId,houseName:house.houseName,communityId:house.communityId,communityName:house.communityName,
        city:house.city,region:house.region,ownerNameMasked:house.ownerNameMasked,mobileMasked:mobile,hasMobile:!!mobile,
        statDate:house.statDate.toISOString().slice(0,10),syncedAt:house.syncedAt.toISOString(),labels,matchedProducts,winningPackage,winningRuleId,
        leadCount:leads.get(house.houseId)??0,openLeadCount:0,lastPushAt:latest?.at.toISOString()??null,lastPushStatus:latest?.status??null};
    });
  }
  async search(query:HouseSearchQuery) {
    const where=this.baseWhere(query);
    const candidateCount=await this.prisma.houseLabelSnapshot.count({where});
    const page=Math.max(1,Number(query.page)||1),pageSize=Math.min(100,Math.max(1,Number(query.pageSize)||20));
    const rules=await this.getRules();const filtered:MatchRow[]=[];let cursor:string|undefined,scanned=0;
    while(scanned<this.maxScan) {
      const take=Math.min(this.batchSize,this.maxScan-scanned);
      const batch=await this.prisma.houseLabelSnapshot.findMany({where,take,orderBy:{houseId:'asc'},...(cursor?{cursor:{houseId:cursor},skip:1}:{})});
      if(!batch.length) break;
      filtered.push(...await this.matchHouses(batch,query,rules));
      scanned+=batch.length;cursor=batch[batch.length-1].houseId;
      if(batch.length<take) break;
    }
    const start=(page-1)*pageSize;
    return {total:filtered.length,candidateCount,page,pageSize,scanLimitReached:candidateCount>scanned,items:await this.enrich(filtered.slice(start,start+pageSize))};
  }
  async findByIds(houseIds:string[]) {
    const ids=[...new Set(houseIds.map(String).map(v=>v.trim()).filter(Boolean))].slice(0,5000);
    if(!ids.length)return [];
    const houses=await this.prisma.houseLabelSnapshot.findMany({where:{houseId:{in:ids}}});
    const matches=await this.matchHouses(houses,{},await this.getRules());
    const enriched=await this.enrich(matches);const byId=new Map(enriched.map(r=>[r.houseId,r]));
    return ids.map(id=>byId.get(id)).filter((row):row is HouseListItem=>!!row);
  }
}
