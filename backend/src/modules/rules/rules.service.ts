import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { evaluateRule, type HouseLabels, type RuleConditionSpec } from '../../engine/rule-engine';

/**
 * 规则管理：列表（priority ASC）、拖拽重排、启停、命中预览。
 * GAP-2 服务端兜底：条件引用尚未接入的标签（house_feature_tags）时禁止启用，
 * 防止运营手工启用后全量空命中的静默错误。
 */
const NOT_READY_TAGS = new Set(['house_feature_tags']);

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.mappingRule.findMany({
      orderBy: [{ priority: 'asc' }],
      include: { package: { select: { id: true, code: true, name: true } }, mutexGroup: true },
    });
  }

  /** 拖拽排序：按传入规则 id 顺序重写 priority（从 10 起、步长 10）。 */
  async reorder(orderedIds: number[]) {
    const ids = orderedIds.map((x) => BigInt(x));
    return this.prisma.$transaction(
      ids.map((id, idx) =>
        this.prisma.mappingRule.update({ where: { id }, data: { priority: (idx + 1) * 10 } }),
      ),
    );
  }

  async setStatus(id: bigint, status: 'enabled' | 'disabled') {
    if (status === 'enabled') {
      const rule = await this.prisma.mappingRule.findUniqueOrThrow({ where: { id } });
      const spec = rule.conditionJson as unknown as RuleConditionSpec;
      const blockedTag = spec.conditions.find((c) => NOT_READY_TAGS.has(c.tag));
      if (blockedTag) {
        throw new BadRequestException(
          `标签 ${blockedTag.tag} 数据尚未接入（DATA-CONTRACT GAP-2），该规则在数据源确认前禁止启用`,
        );
      }
    }
    return this.prisma.mappingRule.update({ where: { id }, data: { status } });
  }

  /**
   * 命中预览：按规则条件在当前快照上统计命中数并返回脱敏样本。
   * 骨架实现逐页扫描（演示数据量级）；生产环境走 labels jsonb GIN 索引或预计算命中表。
   */
  async preview(conditionJson: RuleConditionSpec, sampleSize = 20) {
    const BATCH = 5000;
    let count = 0;
    const samples: unknown[] = [];
    let cursor: string | undefined;
    for (;;) {
      const houses = await this.prisma.houseLabelSnapshot.findMany({
        take: BATCH,
        ...(cursor ? { cursor: { houseId: cursor }, skip: 1 } : {}),
        orderBy: { houseId: 'asc' },
      });
      if (houses.length === 0) break;
      for (const h of houses) {
        if (evaluateRule(conditionJson, (h.labels ?? {}) as HouseLabels)) {
          count++;
          if (samples.length < sampleSize) {
            samples.push({
              houseId: h.houseId,
              communityName: h.communityName,
              houseName: h.houseName,
              region: h.region,
              city: h.city,
              hasMobile: !!h.contactMobileEnc,
            });
          }
        }
      }
      cursor = houses[houses.length - 1].houseId;
      if (houses.length < BATCH) break;
    }
    return { matchedCount: count, samples };
  }
}
