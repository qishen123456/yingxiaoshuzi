import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptMobile, hmacCustomerKey, maskMobile, normalizeMobile } from '../../common/crypto.util';

/**
 * 房屋标签 + 业主手机号 merge（DATA-CONTRACT §3/§5 落地）。
 * 上游 DataWorks 只负责把数据搬到 staging（平铺列、逗号串、明文号），
 * 本服务在 RDS 内完成：标签组装 JSONB、多值拆数组、号码加密+HMAC、回填快照、清明文。
 */
@Injectable()
export class HouseSyncService {
  private readonly logger = new Logger(HouseSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** staging 平铺行 -> labels JSONB（多值标签拆数组，空串/NULL 丢弃）。 */
  private buildLabels(row: {
    waterTagsRaw: string | null;
    electricTagsRaw: string | null;
    applianceTagsRaw: string | null;
    envTagsRaw: string | null;
    priceSensitivity: string | null;
    residenceStatus: string | null;
    familyStructure: string | null;
    decorateStatus: string | null;
    houseTypeName: string | null;
    deliverYear: { toNumber(): number } | number | null;
    propertyArea: { toNumber(): number } | number | null;
    layout: string | null;
    repairKitchen: number;
    repairBalcony: number;
    repairBathroom: number;
  }): Record<string, unknown> {
    const split = (s: string | null): string[] | undefined => {
      const arr = (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      return arr.length ? arr : undefined;
    };
    const num = (v: unknown): number | null =>
      typeof v === 'number' ? v : v && typeof (v as { toNumber?: unknown }).toNumber === 'function'
        ? (v as { toNumber: () => number }).toNumber()
        : null;
    const put = (k: string, v: unknown, o: Record<string, unknown>) => {
      if (v !== null && v !== undefined && v !== '') o[k] = v;
    };

    const labels: Record<string, unknown> = {};
    put('water_tags', split(row.waterTagsRaw), labels);
    put('electric_tags', split(row.electricTagsRaw), labels);
    put('appliance_tags', split(row.applianceTagsRaw), labels);
    put('env_tags', split(row.envTagsRaw), labels);
    put('price_sensitivity', row.priceSensitivity, labels);
    put('residence_status', row.residenceStatus, labels);
    put('family_structure', row.familyStructure, labels);
    put('decorate_status', row.decorateStatus, labels);
    put('house_type_name', row.houseTypeName, labels);
    put('deliver_year', num(row.deliverYear), labels);
    put('property_area', num(row.propertyArea), labels);
    put('layout', row.layout, labels);
    if (row.repairKitchen > 0) labels.repair_kitchen = row.repairKitchen;
    if (row.repairBalcony > 0) labels.repair_balcony = row.repairBalcony;
    if (row.repairBathroom > 0) labels.repair_bathroom = row.repairBathroom;
    return labels;
  }

  /** 节点①：标签 staging upsert 进 house_label_snapshot（号码列不在此步更新，避免覆盖）。 */
  async mergeHouseLabels(): Promise<{ upserted: number; dictionaryValuesAdded: number }> {
    const BATCH = 5000;
    let upserted = 0;
    let cursor: bigint | undefined;
    // 枚举目录初值来自 SQL seed；每日同步时继续发现上游新枚举值并并入 tag_dictionary。
    const enumTags = await this.prisma.tagDictionary.findMany({
      where: { valueType: { in: ['enum', 'multi_enum'] }, sourceColumn: { not: null } },
      select: { tagKey: true, enumValues: true },
    });
    const enumTagKeys = new Set(enumTags.map((t) => t.tagKey));
    const observedValues = new Map<string, Set<string>>();
    const collectValue = (tagKey: string, value: unknown) => {
      if (!enumTagKeys.has(tagKey)) return;
      const bucket = observedValues.get(tagKey) ?? new Set<string>();
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === 'string' && item.trim()) bucket.add(item.trim());
      } else if (typeof value === 'string' && value.trim()) {
        bucket.add(value.trim());
      }
      observedValues.set(tagKey, bucket);
    };
    // 全量覆写语义：以当日 staging 为准。骨架直接 upsert；消失房屋的下线策略属后续运营需求。
    for (;;) {
      const rows = await this.prisma.houseLabelStaging.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const labels = this.buildLabels(row);
        for (const [tagKey, value] of Object.entries(labels)) collectValue(tagKey, value);
      }
      await this.prisma.$transaction(
        rows.map((r) =>
          this.prisma.houseLabelSnapshot.upsert({
            where: { houseId: r.houseId },
            create: {
              houseId: r.houseId,
              zhantuHouseId: r.zhantuHouseId,
              houseName: r.houseName,
              communityId: r.communityId,
              communityName: r.communityName,
              region: r.region,
              city: r.city,
              branch: r.branch,
              station: r.station,
              stationCode: r.stationCode,
              labels: this.buildLabels(r) as Prisma.InputJsonValue,
              statDate: r.statDate,
              syncedAt: new Date(),
            },
            update: {
              zhantuHouseId: r.zhantuHouseId,
              houseName: r.houseName,
              communityId: r.communityId,
              communityName: r.communityName,
              region: r.region,
              city: r.city,
              branch: r.branch,
              station: r.station,
              stationCode: r.stationCode,
              labels: this.buildLabels(r) as Prisma.InputJsonValue,
              statDate: r.statDate,
              syncedAt: new Date(),
            },
          }),
        ),
      );
      upserted += rows.length;
      cursor = rows[rows.length - 1].id;
      if (rows.length < BATCH) break;
    }
    let dictionaryValuesAdded = 0;
    for (const [tagKey, values] of observedValues) {
      if (values.size === 0) continue;
      const current = enumTags.find((t) => t.tagKey === tagKey);
      if (!current) continue;
      const existing = Array.isArray(current.enumValues)
        ? current.enumValues.filter((v): v is string => typeof v === 'string')
        : [];
      const merged = [...new Set([...existing, ...values])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      if (merged.length === existing.length && merged.every((v, i) => v === [...existing].sort((a, b) => a.localeCompare(b, 'zh-CN'))[i])) {
        continue;
      }
      await this.prisma.tagDictionary.update({
        where: { tagKey },
        data: { enumValues: merged as Prisma.InputJsonValue },
      });
      dictionaryValuesAdded += Math.max(0, merged.length - existing.length);
    }

    this.logger.log(`房屋标签 merge 完成：${upserted} 行；标签字典新增枚举值 ${dictionaryValuesAdded} 个`);
    return { upserted, dictionaryValuesAdded };
  }

  /**
   * 节点①b：补号 staging merge。
   * 1) 写 house_mobile_resolve（密文+HMAC+脱敏，去重 upsert）；
   * 2) 每房屋选 is_preferred=true 的最高优先级号回填快照；
   * 3) 清空 staging 明文（合规硬要求）。
   */
  async mergeMobiles(): Promise<{ houses: number; resolvedHouses: number }> {
    const secret = this.config.getOrThrow<string>('CUSTOMER_KEY_SECRET');
    const encKey = this.config.getOrThrow<string>('MOBILE_ENC_KEY_BASE64');

    const staging = await this.prisma.houseMobileStaging.findMany();
    const houses = new Set(staging.map((s) => s.houseId));
    let resolvedHouses = 0;

    for (const houseId of houses) {
      const rows = staging
        .filter((s) => s.houseId === houseId)
        .map((s) => ({ ...s, normalized: normalizeMobile(s.mobileRaw) }))
        .filter((s) => s.normalized !== null);
      if (rows.length === 0) continue;

      await this.prisma.$transaction(
        rows.map((s) =>
          this.prisma.houseMobileResolve.upsert({
            where: {
              houseId_customerKeyHash: {
                houseId: s.houseId,
                customerKeyHash: hmacCustomerKey(s.normalized, secret)!,
              },
            },
            create: {
              houseId: s.houseId,
              mobileEnc: encryptMobile(s.normalized!, encKey),
              customerKeyHash: hmacCustomerKey(s.normalized, secret)!,
              mobileMasked: maskMobile(s.normalized)!,
              mobileSource: s.mobileSource,
              isPreferred: s.isPreferred,
              resolvedAt: new Date(),
            },
            update: {
              mobileSource: s.mobileSource,
              isPreferred: s.isPreferred,
              resolvedAt: new Date(),
            },
          }),
        ),
      );

      // 首选号：staging 已标的 is_preferred 优先；兜底按来源优先级 rich(1) > qywx(2) > crm(3)
      const sourcePriority: Record<string, number> = { rich: 1, qywx: 2, crm: 3 };
      const preferred =
        rows.find((r) => r.isPreferred) ??
        [...rows].sort(
          (a, b) => (sourcePriority[a.mobileSource] ?? 9) - (sourcePriority[b.mobileSource] ?? 9),
        )[0];
      const hash = hmacCustomerKey(preferred.normalized, secret)!;
      const resolveRow = await this.prisma.houseMobileResolve.findUnique({
        where: { houseId_customerKeyHash: { houseId, customerKeyHash: hash } },
      });
      if (resolveRow) {
        await this.prisma.houseLabelSnapshot.updateMany({
          where: { houseId },
          data: { contactMobileEnc: resolveRow.mobileEnc, customerKeyHash: hash },
        });
        resolvedHouses++;
      }
    }

    // 合规：merge 完成立即清空 staging 明文
    await this.prisma.houseMobileStaging.deleteMany({});
    this.logger.log(`补号 merge 完成：${houses.size} 房屋，${resolvedHouses} 回填首选号；staging 明文已清空`);
    return { houses: houses.size, resolvedHouses };
  }
}
