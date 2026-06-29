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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'List staff (pagination, search, filter, sort)' })
  @ApiResponse({ status: 200, description: 'Paginated slim list' })
  async findAll(@Query() query: QueryStaffDto) {
    const result = await this.staffService.findAll(query);
    return { message: 'Staff fetched', data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single staff (full detail)' })
  async findOne(@Param('id') id: string) {
    const staff = await this.staffService.findOne(id);
    return { message: 'Staff fetched', data: staff.toJSON() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create staff' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Duplicate email / cnic_no' })
  async create(@Body() dto: CreateStaffDto) {
    const staff = await this.staffService.create(dto);
    return { message: 'Staff created', data: staff.toJSON() };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Full update (password/photo omitted = keep)' })
  async update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    const staff = await this.staffService.update(id, dto);
    return { message: 'Staff updated', data: staff.toJSON() };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update (toggle staff_status)' })
  async patch(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    const staff = await this.staffService.patch(id, dto);
    return { message: 'Staff updated', data: staff.toJSON() };
  }

  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete by ids' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.staffService.bulkRemove(dto);
    return { message: 'Staff deleted', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete one staff' })
  async remove(@Param('id') id: string) {
    const result = await this.staffService.remove(id);
    return { message: 'Staff deleted', data: result };
  }
}
