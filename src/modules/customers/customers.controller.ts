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
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { ReceivePaymentDto } from './dto/receive-payment.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @RequirePermission('customer', 'view')
  @Get()
  @ApiOperation({ summary: 'List customers (pagination, search, sort)' })
  @ApiResponse({ status: 200, description: 'Paginated slim list' })
  async findAll(@Query() query: QueryCustomerDto) {
    const result = await this.customersService.findAll(query);
    return { message: 'Customers fetched', data: result };
  }

  @RequirePermission('customer', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'Get single customer (full detail)' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const customer = await this.customersService.findOne(id, officeId);
    return { message: 'Customer fetched', data: customer.toJSON() };
  }

  @RequirePermission('customer', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create customer' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Duplicate email / cnic_no' })
  async create(@Body() dto: CreateCustomerDto) {
    const customer = await this.customersService.create(dto);
    return { message: 'Customer created', data: customer.toJSON() };
  }

  @RequirePermission('customer', 'create')
  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Receive a payment against the borrow balance' })
  @ApiResponse({ status: 400, description: 'Payment exceeds the balance' })
  async receivePayment(
    @Param('id') id: string,
    @Body() dto: ReceivePaymentDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const { customer, payment } = await this.customersService.receivePayment(
      id,
      dto,
      userId,
    );
    return {
      message: 'Payment received',
      data: { customer: customer.toJSON(), payment: payment.toJSON() },
    };
  }

  @RequirePermission('customer', 'edit')
  @Put(':id')
  @ApiOperation({ summary: 'Full update (photo omitted = keep)' })
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    const customer = await this.customersService.update(id, dto);
    return { message: 'Customer updated', data: customer.toJSON() };
  }

  @RequirePermission('customer', 'edit')
  @Patch(':id')
  @ApiOperation({ summary: 'Partial update (toggle customer_status)' })
  async patch(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    const customer = await this.customersService.patch(id, dto);
    return { message: 'Customer updated', data: customer.toJSON() };
  }

  @RequirePermission('customer', 'delete')
  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete by ids' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.customersService.bulkRemove(dto);
    return { message: 'Customers deleted', data: result };
  }

  @RequirePermission('customer', 'delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete one customer' })
  async remove(@Param('id') id: string) {
    const result = await this.customersService.remove(id);
    return { message: 'Customer deleted', data: result };
  }
}
