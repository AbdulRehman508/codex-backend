import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BaseReportDto,
  SalesReportDto,
  StockReportDto,
} from './dto/query-report.dto';
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @RequirePermission('reports', 'view')
  @Get('sales')
  @ApiOperation({
    summary: 'Every bill in the period with gross/discount/net/paid/borrow totals',
  })
  async sales(@Query() query: SalesReportDto) {
    const data = await this.reportsService.sales(query);
    return { message: 'Sales report fetched', data };
  }

  @RequirePermission('reports', 'view')
  @Get('products')
  @ApiOperation({
    summary: 'Item-wise sales: units sold and revenue per product',
  })
  async products(@Query() query: BaseReportDto) {
    const data = await this.reportsService.products(query);
    return { message: 'Product report fetched', data };
  }

  @RequirePermission('reports', 'view')
  @Get('stock')
  @ApiOperation({
    summary: 'Stock on hand and its value right now (not a period figure)',
  })
  async stock(@Query() query: StockReportDto) {
    const data = await this.reportsService.stock(query);
    return { message: 'Stock report fetched', data };
  }

  @RequirePermission('reports', 'view')
  @Get('receivables')
  @ApiOperation({
    summary: 'Customer balances, plus borrowed and repaid inside the period',
  })
  async receivables(@Query() query: BaseReportDto) {
    const data = await this.reportsService.receivables(query);
    return { message: 'Receivables report fetched', data };
  }

  @RequirePermission('reports', 'view')
  @Get('payables')
  @ApiOperation({
    summary: 'Supplier balances, plus purchased and paid inside the period',
  })
  async payables(@Query() query: BaseReportDto) {
    const data = await this.reportsService.payables(query);
    return { message: 'Payables report fetched', data };
  }
}
