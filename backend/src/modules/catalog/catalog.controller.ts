import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 产品包与规则标签选项。标签类别固定为业务当前使用的四组，选项值由 tag_value 数据表维护。 */
@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  /** 产品包列表（含包内 SKU 与所属互斥组）。 */
  @Get('packages')
  packages() {
    return this.prisma.productPackage.findMany({
      orderBy: { id: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /** 从房屋标签快照汇总城市与责任盘项目，用于定时计划的范围选择。 */
  @Get('project-catalog')
  async projectCatalog() {
    const rows = await this.prisma.houseLabelSnapshot.findMany({
      where: { city: { not: null }, communityId: { not: null }, communityName: { not: null } },
      select: { city: true, communityId: true, communityName: true },
      distinct: ['city', 'communityId'],
      orderBy: [{ city: 'asc' }, { communityName: 'asc' }],
    });

    return rows
      .filter((row) => !!row.city && !!row.communityId && !!row.communityName)
      .map((row) => ({
        city: row.city!,
        projectId: row.communityId!,
        projectName: row.communityName!,
      }));
  }

  /**
   * 搜索选择器的标签来源。
   * 只向规则页返回原有四类核心标签；每个可选标签值一行存于 tag_value。
   * 将 enumValues 组装成旧前端契约，避免 UI 与数据库模型耦合。
   */
  @Get('tags')
  async tags() {
    const rows = await this.prisma.tagDictionary.findMany({
      where: { tagKey: { in: ['water_tags', 'env_tags', 'family_structure', 'decorate_status'] } },
      orderBy: [{ tagGroup: 'asc' }, { tagKey: 'asc' }],
      include: {
        tagValues: {
          where: { status: 'enabled' },
          orderBy: [{ sortOrder: 'asc' }, { tagValue: 'asc' }],
          select: { tagValue: true },
        },
      },
    });

    return rows.map(({ tagValues, ...tag }) => ({
      ...tag,
      enumValues: tagValues.map((item) => item.tagValue),
    }));
  }
}
