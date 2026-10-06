import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import { DashboardService } from './dashboard.service';
import { QueryDashboardDto } from './dto/query-dashboard.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @RequirePermission('dashboard', 'view')
  @Get()
  @ApiOperation({
    summary:
      'Everything the dashboard shows for one office and period: KPIs vs the previous period, sales trend, payment mix, top products, recent orders, low stock',
  })
  async overview(@Query() query: QueryDashboardDto) {
    const data = await this.dashboardService.overview(query);
    return { message: 'Dashboard fetched', data };
  }
}
