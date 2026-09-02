import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateSaleDto } from './dto/create-sale.dto';
import { QuerySaleDto } from './dto/query-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { SalesService } from './sales.service';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @ApiOperation({ summary: 'List sales (pagination, search, filter, sort)' })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  async findAll(@Query() query: QuerySaleDto) {
    const result = await this.salesService.findAll(query);
    return { message: 'Sales fetched', data: result };
  }

  // declared before :id so the literal path wins
  @Get('stats')
  @ApiOperation({ summary: "Today's total, transaction count, average order" })
  @ApiQuery({ name: 'office_id', required: false })
  async stats(@Query('office_id') officeId?: string) {
    const data = await this.salesService.stats(officeId);
    return { message: 'Sale stats fetched', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one sale with its lines (receipt / print)' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.salesService.findOneDetail(id, officeId);
    return { message: 'Sale fetched', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a sale and take its items out of stock' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Not enough stock' })
  async create(
    @Body() dto: CreateSaleDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const sale = await this.salesService.create(dto, userId);
    return { message: 'Sale created', data: sale.toJSON() };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Full update (stock is re-balanced to match)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSaleDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const sale = await this.salesService.update(id, dto, userId);
    return { message: 'Sale updated', data: sale.toJSON() };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Partial update (status change; refund returns the stock)',
  })
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdateSaleDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const sale = await this.salesService.patch(id, dto, userId);
    return { message: 'Sale updated', data: sale.toJSON() };
  }

  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete by ids (stock returned)' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.salesService.bulkRemove(dto);
    return { message: 'Sales deleted', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete one sale (stock returned)' })
  async remove(@Param('id') id: string) {
    const result = await this.salesService.remove(id);
    return { message: 'Sale deleted', data: result };
  }
}
