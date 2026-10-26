import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import {
  AvailableStockDto,
  CreateStockRequestDto,
  DeclineStockRequestDto,
  QueryStockRequestDto,
} from './dto/stock-request.dto';
import { RequestsService } from './requests.service';

@ApiTags('stock')
@ApiBearerAuth()
@Controller('stock/requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @RequirePermission('stock', 'view')
  @Get()
  @ApiOperation({
    summary: 'Stock requests this branch sent or was sent',
  })
  async findAll(@Query() query: QueryStockRequestDto) {
    const data = await this.requests.findAll(query);
    return { message: 'Stock requests fetched', data };
  }

  // before :id, or "available" is read as an id
  @RequirePermission('stock', 'view')
  @Get('available')
  @ApiOperation({
    summary: 'Products another branch has on the shelf, for the request picker',
  })
  async available(@Query() query: AvailableStockDto) {
    const data = await this.requests.available(query);
    return { message: 'Available stock fetched', data };
  }

  @RequirePermission('stock', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'One request with its lines' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.requests.findOne(id, officeId);
    return { message: 'Stock request fetched', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ask another branch for stock — nothing moves until they approve',
  })
  @ApiResponse({ status: 400, description: 'Not that much stock at the other branch' })
  async create(
    @Body() dto: CreateStockRequestDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const doc = await this.requests.create(dto, userId);
    return { message: 'Stock request sent', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'edit')
  @Patch(':id/approve')
  @ApiOperation({
    summary: 'Approve a request — this is what moves the stock',
  })
  @ApiQuery({ name: 'office_id', required: false })
  @ApiResponse({ status: 403, description: 'Only the branch that was asked may answer' })
  async approve(
    @Param('id') id: string,
    @CurrentUser('sub') userId?: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.requests.approve(id, userId, officeId);
    return { message: 'Stock request approved', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'edit')
  @Patch(':id/decline')
  @ApiOperation({ summary: 'Decline a request, with the reason why' })
  @ApiQuery({ name: 'office_id', required: false })
  async decline(
    @Param('id') id: string,
    @Body() dto: DeclineStockRequestDto,
    @CurrentUser('sub') userId?: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.requests.decline(id, dto.reason, userId, officeId);
    return { message: 'Stock request declined', data: doc.toJSON() };
  }

  @RequirePermission('stock', 'create')
  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Take back a request that has not been answered yet' })
  @ApiQuery({ name: 'office_id', required: false })
  async cancel(
    @Param('id') id: string,
    @CurrentUser('sub') userId?: string,
    @Query('office_id') officeId?: string,
  ) {
    const doc = await this.requests.cancel(id, userId, officeId);
    return { message: 'Stock request cancelled', data: doc.toJSON() };
  }
}
