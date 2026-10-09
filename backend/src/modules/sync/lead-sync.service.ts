import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hmacCustomerKey, normalizeMobile } from '../../common/crypto.util';

/**
 * 线索 merge（DATA-CONTRACT §4）。
 * 同步层只排测试数据+责任盘（dw_03 已做）；本 merge 负责：
 * 客户键 HMAC、房屋双键回落、external 产品包字典映射、stale 标记、幂等 upsert（不覆盖归因字段）、清明文。
 */

const SEEP_KEYWORDS = ['防水', '补漏', '渗水', '漏水', '卫生间漏', '厨房漏'];
const TUB_KEYWORDS = ['浴缸', '浴改淋', '淋浴改造'];
const REFRESH_KEYWORDS = ['刷新', '墙面', '涂料', '焕新修缮'];

@Injectable()
export class LeadSyncService {
  private readonly logger = new Logger(LeadSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** external 产品包识别（§4.3 候选词表；GAP-3 盘点后随版本冻结）。返回系统包 code 或 null。 */
  private resolveExternalPackage(row: {
    isRepair: string | null;
    intentionFirstType: string | null;
    externalPackageCode: string | null;
  }): string | null {
    const haystack = `${row.intentionFirstType ?? ''}|${row.externalPackageCode ?? ''}`;
    const hit = (words: string[]) => words.some((w) => haystack.includes(w));
    if (row.isRepair === '是' && hit(SEEP_KEYWORDS)) return 'PKG-SEEP';
    if (row.intentionFirstType === '局部改造' && hit(TUB_KEYWORDS)) return 'PKG-TUB2SHOWER';
    if (
      (row.intentionFirstType === '单品焕新' || row.intentionFirstType === '局部改造') &&
      hit(REFRESH_KEYWORDS)
    )
      return 'PKG-REFRESH';
    return null;
  }

  /** 降级客户键：有手机号=HMAC；无号有 pride 房=house: 前缀；皆无=unmatched: 前缀（不与 HMAC hex 碰撞）。 */
  private buildCustomerKey(row: { mobileRaw: string | null; houseIdPride: string | null; leadId: string }, secret: string) {
    const mobile = normalizeMobile(row.mobileRaw);
    if (mobile) return { key: hmacCustomerKey(mobile, secret)!, type: 'mobile_hash' as const };
    if (row.houseIdPride) return { key: `house:${row.houseIdPride}`, type: 'house_only' as const };
    return { key: `unmatched:${row.leadId}`, type: 'unmatched' as const };
  }

  async mergeLeads(): Promise<{ upserted: number; external: number; unmatchedHouse: number }> {
    const secret = this.config.getOrThrow<string>('CUSTOMER_KEY_SECRET');
    const BATCH = 2000;
    let upserted = 0;
    let external = 0;
    let unmatchedHouse = 0;
    const seenLeadIds: string[] = [];

    // 预载系统包字典 code -> id
    const packages = await this.prisma.productPackage.findMany({ select: { id: true, code: true } });
    const pkgIdByCode = new Map(packages.map((p) => [p.code, p.id]));

    let cursor: bigint | undefined;
    for (;;) {
      const rows = await this.prisma.leadRecordStaging.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      });
      if (rows.length === 0) break;

      // 战图码回落：本批 zhantu 码 -> pride 码
      const zhantus = rows.map((r) => r.houseIdZhantu).filter(Boolean) as string[];
      const fallbackHouses = zhantus.length
        ? await this.prisma.houseLabelSnapshot.findMany({
            where: { zhantuHouseId: { in: zhantus } },
            select: { houseId: true, zhantuHouseId: true },
          })
        : [];
      const prideByZhantu = new Map(fallbackHouses.map((h) => [h.zhantuHouseId as string, h.houseId]));

      const ops: Prisma.PrismaPromise<unknown>[] = [];
      for (const r of rows) {
        seenLeadIds.push(r.leadId);
        const { key, type } = this.buildCustomerKey(r, secret);

        let houseId = r.houseIdPride ?? null;
        let houseMatchType: string | null = houseId ? 'pride' : null;
        if (!houseId && r.houseIdZhantu) {
          const fallback = prideByZhantu.get(r.houseIdZhantu);
          if (fallback) {
            houseId = fallback;
            houseMatchType = 'zhantu_fallback';
          }
        }
        if (!houseId) {
          houseMatchType = null;
          unmatchedHouse++;
        }

        const externalCode = r.externalPackageCode || null;
        const pkgCode = this.resolveExternalPackage(r);
        const packageId = pkgCode ? pkgIdByCode.get(pkgCode) ?? null : null;
        const packageSource = packageId ? ('external' as const) : ('none' as const);
        if (packageId) external++;

        ops.push(
          this.prisma.leadRecord.upsert({
            where: { leadId: r.leadId },
            create: {
              leadId: r.leadId,
              customerKey: key,
              customerKeyType: type,
              houseId,
              houseMatchType,
              productPackageId: packageId,
              externalPackageCode: externalCode,
              packageSource,
              leadGrade: r.leadGradeRaw,
              leadStatus: r.leadStatusRaw,
              leadQuality: r.leadQuality,
              isValidForReno: r.isValidForReno,
              isValidForRepair: r.isValidForRepair,
              staleInSource: false,
              latestDealAt: r.latestDealAt,
              orderCnt: r.orderCnt,
              performanceAmount: r.performanceAmount,
              sourceChannel: r.sourceChannel,
              leadCreatedAt: r.leadCreatedAt,
              statDate: r.statDate,
              syncedAt: new Date(),
            },
            update: {
              // 只更新外部字段；归因字段（first/lastTouch、attributedAt、window）绝不覆盖
              customerKey: key,
              customerKeyType: type,
              houseId,
              houseMatchType,
              productPackageId: packageId,
              externalPackageCode: externalCode,
              packageSource,
              leadGrade: r.leadGradeRaw,
              leadStatus: r.leadStatusRaw,
              leadQuality: r.leadQuality,
              isValidForReno: r.isValidForReno,
              isValidForRepair: r.isValidForRepair,
              staleInSource: false,
              latestDealAt: r.latestDealAt,
              orderCnt: r.orderCnt,
              performanceAmount: r.performanceAmount,
              sourceChannel: r.sourceChannel,
              leadCreatedAt: r.leadCreatedAt,
              statDate: r.statDate,
              syncedAt: new Date(),
            },
          }),
        );
      }
      await this.prisma.$transaction(ops);
      upserted += rows.length;
      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }

    // 全量快照语义：本次未出现的存量线索打 stale（不物理删除）。骨架整表标记，量大时改分批。
    if (seenLeadIds.length) {
      const staleRes = await this.prisma.leadRecord.updateMany({
        where: { leadId: { notIn: seenLeadIds }, staleInSource: false },
        data: { staleInSource: true },
      });
      if (staleRes.count > 0) this.logger.warn(`标记源端消失线索 ${staleRes.count} 条（stale_in_source=true，不删除）`);
    }

    // 合规：清空 staging 明文手机号列（整表删除，staging 为可重建的临时数据）
    await this.prisma.leadRecordStaging.deleteMany({});
    this.logger.log(`线索 merge 完成：${upserted} 条，external 命中 ${external}，房屋未关联 ${unmatchedHouse}；明文已清`);
    return { upserted, external, unmatchedHouse };
  }
}
