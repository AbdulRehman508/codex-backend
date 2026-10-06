import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { QueryAdjustmentDto } from './dto/query-adjustment.dto';
import { StockService } from './stock.service';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/adjustments')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @RequirePermission('stock', 'view')
  @Get()
  @ApiOperation({
    summary: 'Stock movements that were not sales or purchases, with totals',
  })
  async findAll(@Query() query: QueryAdjustmentDto) {
    const result = await this.stockService.findAll(query);
    return { message: 'Stock adjustments fetched', data: result };
  }

  @RequirePermission('stock', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'Get one adjustment' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.stockService.findOne(id, officeId);
    return { message: 'Stock adjustment fetched', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Adjust a product count (entries are an audit trail, never edited)',
  })
  @ApiResponse({ status: 400, description: 'Not enough stock, or it changed meanwhile' })
  async create(
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const doc = await this.stockService.create(dto, userId);
    return { message: 'Stock adjusted', data: doc.toJSON() };
  }
}
