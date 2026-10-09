import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { IsArray, IsInt, IsIn, IsObject } from 'class-validator';
import { type RuleConditionSpec } from '../../engine/rule-engine';
import { RulesService } from './rules.service';

class ReorderDto {
  @IsArray()
  @IsInt({ each: true })
  orderedIds!: number[];
}

class StatusDto {
  @IsIn(['enabled', 'disabled'])
  status!: 'enabled' | 'disabled';
}

class PreviewDto {
  @IsObject()
  conditionJson!: RuleConditionSpec;
}

@Controller('rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  /** 规则列表（按 priority 升序，供拖拽排序页直接渲染）。 */
  @Get()
  list() {
    return this.rules.list();
  }

  /** 拖拽排序：传入排序后的规则 id 列表。 */
  @Post('reorder')
  reorder(@Body() dto: ReorderDto) {
    return this.rules.reorder(dto.orderedIds);
  }

  @Patch(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto) {
    return this.rules.setStatus(BigInt(id), dto.status);
  }

  /** 命中预览：提交规则条件 JSON，返回命中房屋数与脱敏样本。 */
  @Post('preview')
  preview(@Body() dto: PreviewDto) {
    return this.rules.preview(dto.conditionJson);
  }
}
