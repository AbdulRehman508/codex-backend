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
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { PaySupplierDto } from './dto/pay-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @RequirePermission('supplier', 'view')
  @Get()
  @ApiOperation({ summary: 'List suppliers (pagination, search, sort)' })
  async findAll(@Query() query: QuerySupplierDto) {
    const result = await this.suppliersService.findAll(query);
    return { message: 'Suppliers fetched', data: result };
  }

  @RequirePermission('supplier', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'Get one supplier' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const supplier = await this.suppliersService.findOne(id, officeId);
    return { message: 'Supplier fetched', data: supplier.toJSON() };
  }

  @RequirePermission('supplier', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create supplier' })
  @ApiResponse({ status: 409, description: 'Duplicate mobile_no' })
  async create(@Body() dto: CreateSupplierDto) {
    const supplier = await this.suppliersService.create(dto);
    return { message: 'Supplier created', data: supplier.toJSON() };
  }

  @RequirePermission('supplier', 'edit')
  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pay a supplier against their payable balance' })
  @ApiResponse({ status: 400, description: 'Payment exceeds the balance' })
  async pay(
    @Param('id') id: string,
    @Body() dto: PaySupplierDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const { supplier, payment } = await this.suppliersService.pay(id, dto, userId);
    return {
      message: 'Payment recorded',
      data: { supplier: supplier.toJSON(), payment: payment.toJSON() },
    };
  }

  @RequirePermission('supplier', 'edit')
  @Put(':id')
  @ApiOperation({ summary: 'Full update' })
  async update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    const supplier = await this.suppliersService.update(id, dto);
    return { message: 'Supplier updated', data: supplier.toJSON() };
  }

  @RequirePermission('supplier', 'edit')
  @Patch(':id')
  @ApiOperation({ summary: 'Partial update (toggle status)' })
  async patch(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    const supplier = await this.suppliersService.patch(id, dto);
    return { message: 'Supplier updated', data: supplier.toJSON() };
  }

  @RequirePermission('supplier', 'delete')
  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete (blocked while money is owed)' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.suppliersService.bulkRemove(dto);
    return { message: 'Suppliers deleted', data: result };
  }

  @RequirePermission('supplier', 'delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete (blocked while money is owed)' })
  async remove(@Param('id') id: string) {
    const result = await this.suppliersService.remove(id);
    return { message: 'Supplier deleted', data: result };
  }
}
