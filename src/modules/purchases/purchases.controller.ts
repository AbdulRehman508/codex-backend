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
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { QueryPurchaseDto } from './dto/query-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('purchases')
@ApiBearerAuth()
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @RequirePermission('purchase', 'view')
  @Get()
  @ApiOperation({
    summary: 'List purchases with total / paid / payable for the same filters',
  })
  async findAll(@Query() query: QueryPurchaseDto) {
    const result = await this.purchasesService.findAll(query);
    return { message: 'Purchases fetched', data: result };
  }

  @RequirePermission('purchase', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'Get one purchase with its lines' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const purchase = await this.purchasesService.findOne(id, officeId);
    return { message: 'Purchase fetched', data: purchase.toJSON() };
  }

  @RequirePermission('purchase', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a purchase: raises stock and the supplier payable',
  })
  async create(
    @Body() dto: CreatePurchaseDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const purchase = await this.purchasesService.create(dto, userId);
    return { message: 'Purchase recorded', data: purchase.toJSON() };
  }

  @RequirePermission('purchase', 'edit')
  @Put(':id')
  @ApiOperation({ summary: 'Full update (stock and payable re-balanced)' })
  @ApiResponse({
    status: 400,
    description: 'Reversal would drive stock negative — already sold',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const purchase = await this.purchasesService.update(id, dto, userId);
    return { message: 'Purchase updated', data: purchase.toJSON() };
  }

  @RequirePermission('purchase', 'edit')
  @Patch(':id')
  @ApiOperation({
    summary: 'Partial update (cancelling returns the stock and the payable)',
  })
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const purchase = await this.purchasesService.patch(id, dto, userId);
    return { message: 'Purchase updated', data: purchase.toJSON() };
  }

  @RequirePermission('purchase', 'delete')
  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete (stock and payable returned)' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.purchasesService.bulkRemove(dto);
    return { message: 'Purchases deleted', data: result };
  }

  @RequirePermission('purchase', 'delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete (stock and payable returned)' })
  async remove(@Param('id') id: string) {
    const result = await this.purchasesService.remove(id);
    return { message: 'Purchase deleted', data: result };
  }
}
