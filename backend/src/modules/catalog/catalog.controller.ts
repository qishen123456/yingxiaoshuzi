import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 产品包与标签字典（只读）。 */
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

  /** 标签字典（启用态优先按 sortOrder 排列）；source_column=null 表示数据尚未接入（GAP-2）。 */
  @Get('tags')
  tags() {
    return this.prisma.tagDictionary.findMany({
      orderBy: [{ tagGroup: 'asc' }, { tagKey: 'asc' }],
    });
  }
}
