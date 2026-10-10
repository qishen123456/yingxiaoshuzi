import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

class AddTagValueDto {
  @IsString()
  @MaxLength(128)
  value!: string;
}

/** 产品包与上游标签字典。标签值目录从房屋标签同步并允许补录。 */
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

  /** 完整标签字典：字段、来源列、值类型及上游实际出现的枚举值。 */
  @Get('tags')
  tags() {
    return this.prisma.tagDictionary.findMany({
      orderBy: [{ tagGroup: 'asc' }, { tagKey: 'asc' }],
    });
  }

  /** 将上游观察到或经业务确认的标签值写回 tag_dictionary.enum_values。 */
  @Patch('tags/:tagKey/values')
  async addTagValue(@Param('tagKey') tagKey: string, @Body() dto: AddTagValueDto) {
    const value = dto.value.trim();
    if (!value) throw new BadRequestException('标签值不能为空');

    const tag = await this.prisma.tagDictionary.findUnique({ where: { tagKey } });
    if (!tag) throw new NotFoundException(`标签字段不存在：${tagKey}`);
    if (tag.valueType !== 'enum' && tag.valueType !== 'multi_enum') {
      throw new BadRequestException('只有枚举型或多值枚举型标签支持维护标签值');
    }

    const current = Array.isArray(tag.enumValues)
      ? tag.enumValues.filter((v): v is string => typeof v === 'string')
      : [];
    if (current.includes(value)) return tag;

    return this.prisma.tagDictionary.update({
      where: { tagKey },
      data: { enumValues: [...current, value] as Prisma.InputJsonValue },
    });
  }
}
