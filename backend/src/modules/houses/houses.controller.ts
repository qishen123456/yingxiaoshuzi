import { Controller, Get, Query } from '@nestjs/common';
import { HousesService, type HouseSearchQuery } from './houses.service';

@Controller('houses')
export class HousesController {
  constructor(private readonly houses: HousesService) {}
  @Get()
  search(@Query() query: HouseSearchQuery) { return this.houses.search(query); }
}
