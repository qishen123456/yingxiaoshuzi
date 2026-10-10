import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** 产品包与标签字典（只读）。标签由运营 / 数据团队维护数据库字典，前端按字典动态读取。 */
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

  /** 标签字典：由 tag_dictionary 维护，前端按固定业务标签类别动态消费枚举值。 */
  @Get('tags')
  tags() {
    return this.prisma.tagDictionary.findMany({
      orderBy: [{ tagGroup: 'asc' }, { tagKey: 'asc' }],
    });
  }
}
