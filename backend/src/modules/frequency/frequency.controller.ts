import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BLOCKED_START_HOUR, BLOCKED_END_HOUR } from '../../common/time.util';

/** 频控配置只读接口（含禁发时段代码级常量，前端只展示不可编辑）。 */
@Controller('frequency')
export class FrequencyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get() {
    const rule = await this.prisma.pushFrequencyRule.findFirst({
      where: { scopeType: 'global' },
      include: { windows: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
    });
    return {
      rule: rule
        ? {
            ...rule,
            id: rule.id.toString(),
            packageId: rule.packageId?.toString() ?? null,
          }
        : null,
      blockedWindow: { start: `${BLOCKED_START_HOUR}:00`, end: `0${BLOCKED_END_HOUR}:00`, configurable: false },
    };
  }
}
