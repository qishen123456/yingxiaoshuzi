import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** 产品包与规则标签选项。规则可用类别由 tag_dictionary.rule_enabled 控制，选项值逐行维护在 tag_value。 */
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
   * 产品规则搜索器标签目录。
   * 返回所有 rule_enabled=true 的枚举字段，不按 tag_key 写死类别。
   * 新增类别并插入 tag_value 后，无需修改前端即可出现在规则选择器。
   */
  @Get('tags')
  async tags() {
    const rows = await this.prisma.tagDictionary.findMany({
      where: {
        ruleEnabled: true,
        valueType: { in: ['enum', 'multi_enum'] },
      },
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
  @Get('tags/admin')
  async tagsAdmin() {
    const rows = await this.prisma.tagDictionary.findMany({
      orderBy: [{ tagGroup: 'asc' }, { tagKey: 'asc' }],
      include: { tagValues: { orderBy: [{ sortOrder: 'asc' }, { tagValue: 'asc' }] } },
    });
    return rows.map(({ tagValues, ...tag }) => ({
      ...tag,
      enumValues: tagValues.filter((v) => v.status === 'enabled').map((v) => v.tagValue),
      values: tagValues.map((v) => ({ tagValue: v.tagValue, status: v.status, sortOrder: v.sortOrder })),
      dataReady: !!tag.sourceColumn,
    }));
  }

  @Post('tags/admin')
  async createTag(@Body() body: {
    tagKey?: string; tagName?: string; tagGroup?: string; valueType?: string;
    sourceColumn?: string | null; ruleEnabled?: boolean; enumValues?: string[];
  }) {
    const tagKey = String(body.tagKey ?? '').trim();
    const tagName = String(body.tagName ?? '').trim();
    const sourceColumn = String(body.sourceColumn ?? '').trim() || null;
    const tagGroup = String(body.tagGroup ?? 'other').trim() || 'other';
    const valueType = String(body.valueType ?? 'multi_enum');
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(tagKey)) throw new BadRequestException('标签编码仅支持小写字母、数字和下划线，且以字母开头');
    if (!tagName) throw new BadRequestException('标签名称不能为空');
    if (!['enum', 'multi_enum', 'number', 'string', 'boolean'].includes(valueType)) throw new BadRequestException('不支持的标签类型');
    const values = Array.isArray(body.enumValues) ? [...new Set(body.enumValues.map((v) => String(v).trim()).filter(Boolean))] : [];
    const ruleEnabled = !!body.ruleEnabled && !!sourceColumn && ['enum', 'multi_enum'].includes(valueType);
    return this.prisma.$transaction(async (tx) => {
      await tx.tagDictionary.create({ data: { tagKey, tagName, tagGroup, valueType, sourceColumn, ruleEnabled, enumValues: values as Prisma.InputJsonValue } });
      for (let i = 0; i < values.length; i++) await tx.tagValue.create({ data: { tagKey, tagValue: values[i], sortOrder: i + 1 } });
      const row = await tx.tagDictionary.findUniqueOrThrow({ where: { tagKey }, include: { tagValues: { orderBy: [{ sortOrder: 'asc' }, { tagValue: 'asc' }] } } });
      return { ...row, enumValues: row.tagValues.filter((v) => v.status === 'enabled').map((v) => v.tagValue), dataReady: !!row.sourceColumn };
    });
  }

  @Patch('tags/admin/:tagKey')
  async updateTag(@Param('tagKey') tagKey: string, @Body() body: {
    tagName?: string; tagGroup?: string; valueType?: string; sourceColumn?: string | null;
    ruleEnabled?: boolean; enumValues?: string[];
  }) {
    const current = await this.prisma.tagDictionary.findUnique({ where: { tagKey } });
    if (!current) throw new BadRequestException('标签不存在');
    const tagName = body.tagName === undefined ? current.tagName : String(body.tagName).trim();
    const tagGroup = body.tagGroup === undefined ? current.tagGroup : String(body.tagGroup).trim() || 'other';
    const valueType = body.valueType === undefined ? current.valueType : String(body.valueType);
    const sourceColumn = body.sourceColumn === undefined ? current.sourceColumn : (String(body.sourceColumn ?? '').trim() || null);
    if (!tagName) throw new BadRequestException('标签名称不能为空');
    if (!['enum', 'multi_enum', 'number', 'string', 'boolean'].includes(valueType)) throw new BadRequestException('不支持的标签类型');
    const ruleEnabled = (body.ruleEnabled === undefined ? current.ruleEnabled : !!body.ruleEnabled) && !!sourceColumn && ['enum', 'multi_enum'].includes(valueType);
    const values = Array.isArray(body.enumValues) ? [...new Set(body.enumValues.map((v) => String(v).trim()).filter(Boolean))] : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.tagDictionary.update({ where: { tagKey }, data: { tagName, tagGroup, valueType, sourceColumn, ruleEnabled, ...(values ? { enumValues: values as Prisma.InputJsonValue } : {}) } });
      if (values) {
        const wanted = new Set(values);
        for (let i = 0; i < values.length; i++) await tx.tagValue.upsert({
          where: { tagKey_tagValue: { tagKey, tagValue: values[i] } },
          create: { tagKey, tagValue: values[i], status: 'enabled', sortOrder: i + 1 },
          update: { status: 'enabled', sortOrder: i + 1 },
        });
        const old = await tx.tagValue.findMany({ where: { tagKey }, select: { tagValue: true } });
        const removed = old.filter((v) => !wanted.has(v.tagValue)).map((v) => v.tagValue);
        if (removed.length) await tx.tagValue.updateMany({ where: { tagKey, tagValue: { in: removed } }, data: { status: 'disabled' } });
      }
      const row = await tx.tagDictionary.findUniqueOrThrow({ where: { tagKey }, include: { tagValues: { orderBy: [{ sortOrder: 'asc' }, { tagValue: 'asc' }] } } });
      return { ...row, enumValues: row.tagValues.filter((v) => v.status === 'enabled').map((v) => v.tagValue), dataReady: !!row.sourceColumn };
    });
  }

}
