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
import { CreateOfficeDto } from './dto/create-office.dto';
import { QueryOfficeDto } from './dto/query-office.dto';
import { UpdateOfficeDto } from './dto/update-office.dto';
import { OfficeService } from './office.service';

@ApiTags('offices')
@ApiBearerAuth()
@Controller('offices')
export class OfficeController {
  constructor(private readonly officeService: OfficeService) {}

  @Get()
  @ApiOperation({ summary: 'List offices (pagination, search, sort)' })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  async findAll(@Query() query: QueryOfficeDto) {
    const result = await this.officeService.findAll(query);
    return { message: 'Offices fetched', data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single office (full detail)' })
  async findOne(@Param('id') id: string) {
    const office = await this.officeService.findOne(id);
    return { message: 'Office fetched', data: office.toJSON() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create office' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Duplicate office_email' })
  async create(@Body() dto: CreateOfficeDto) {
    const office = await this.officeService.create(dto);
    return { message: 'Office created', data: office.toJSON() };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Full update' })
  async update(@Param('id') id: string, @Body() dto: UpdateOfficeDto) {
    const office = await this.officeService.update(id, dto);
    return { message: 'Office updated', data: office.toJSON() };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partial update (toggle approved / status)' })
  async patch(@Param('id') id: string, @Body() dto: UpdateOfficeDto) {
    const office = await this.officeService.patch(id, dto);
    return { message: 'Office updated', data: office.toJSON() };
  }

  @Delete()
  @ApiOperation({ summary: 'Bulk soft-delete by ids' })
  async bulkRemove(@Body() dto: BulkDeleteDto) {
    const result = await this.officeService.bulkRemove(dto);
    return { message: 'Offices deleted', data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete one office' })
  async remove(@Param('id') id: string) {
    const result = await this.officeService.remove(id);
    return { message: 'Office deleted', data: result };
  }
}
