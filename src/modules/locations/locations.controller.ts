import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { CreateRackDto } from './dto/create-rack.dto';
import { QueryRackDto } from './dto/query-rack.dto';
import { UpdateRackDto } from './dto/update-rack.dto';
import { LocationsService } from './locations.service';

@ApiTags('locations')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'List racks (pagination, search, filter, sort)' })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  async findAll(@Query() query: QueryRackDto) {
    const result = await this.locationsService.findAll(query);
    return { message: 'Locations fetched', data: result };
  }

  // --- dependent dropdowns (declared before :id so paths stay unambiguous) ---

  @Get(':rackId/rows')
  @ApiOperation({ summary: 'Rows of a rack' })
  @ApiQuery({ name: 'office_id', required: false })
  async rows(
    @Param('rackId') rackId: string,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.locationsService.listRows(rackId, officeId);
    return { message: 'Rows fetched', data };
  }

  @Get(':rackId/rows/:row/columns')
  @ApiOperation({ summary: 'Columns of a row' })
  @ApiQuery({ name: 'office_id', required: false })
  async columns(
    @Param('rackId') rackId: string,
    @Param('row', ParseIntPipe) row: number,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.locationsService.listColumns(rackId, row, officeId);
    return { message: 'Columns fetched', data };
  }

  @Get(':rackId/rows/:row/columns/:column/bins')
  @ApiOperation({ summary: 'Bins of a column (assignable locations)' })
  @ApiQuery({ name: 'office_id', required: false })
  async bins(
    @Param('rackId') rackId: string,
    @Param('row', ParseIntPipe) row: number,
    @Param('column', ParseIntPipe) column: number,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.locationsService.listBins(
      rackId,
      row,
      column,
      officeId,
    );
    return { message: 'Bins fetched', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one rack with all generated locations' })
  @ApiQuery({ name: 'office_id', required: false })
  async findOne(
    @Param('id') id: string,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.locationsService.findOneDetail(id, officeId);
    return { message: 'Location fetched', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create rack and generate its row/column/bin grid' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Duplicate rack code' })
  async create(
    @Body() dto: CreateRackDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const rack = await this.locationsService.create(dto, userId);
    return { message: 'Location created', data: rack.toJSON() };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Full update (regenerates the grid when it changes)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRackDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const rack = await this.locationsService.update(id, dto, userId);
    return { message: 'Location updated', data: rack.toJSON() };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update (toggle status)' })
  async patch(
    @Param('id') id: string,
    @Body() dto: UpdateRackDto,
    @CurrentUser('sub') userId?: string,
  ) {
    const rack = await this.locationsService.patch(id, dto, userId);
    return { message: 'Location updated', data: rack.toJSON() };
  }

  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete by ids' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.locationsService.bulkRemove(dto);
    return { message: 'Locations deleted', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a rack and its locations' })
  @ApiResponse({ status: 409, description: 'Some locations still hold products' })
  async remove(@Param('id') id: string) {
    const result = await this.locationsService.remove(id);
    return { message: 'Location deleted', data: result };
  }
}
