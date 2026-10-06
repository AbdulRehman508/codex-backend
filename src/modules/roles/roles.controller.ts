import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { BulkDeleteRoleDto } from './dto/bulk-delete-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RequirePermission } from '../../common/permissions/permissions.decorator';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermission('role', 'view')
  @Get()
  @ApiOperation({ summary: 'List roles (pagination, search, office filter)' })
  @ApiResponse({ status: 200, description: 'Paginated list' })
  async findAll(@Query() query: QueryRoleDto) {
    const result = await this.rolesService.findAll(query);
    return { message: 'Roles fetched', data: result };
  }

  @RequirePermission('role', 'view')
  @Get('options')
  @ApiOperation({ summary: 'List roles for one or more offices (dropdown)' })
  @ApiQuery({
    name: 'office_id',
    required: false,
    description: 'Comma-separated office ids',
  })
  async options(@Query('office_id') officeId?: string) {
    const officeIds = officeId
      ? officeId
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const data = await this.rolesService.findForDropdown(officeIds);
    return { message: 'Roles fetched', data };
  }

  @RequirePermission('role', 'view')
  @Get(':id')
  @ApiOperation({ summary: 'Get single role' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.rolesService.findOne(id);
    return { message: 'Role fetched', data };
  }

  @RequirePermission('role', 'create')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create role' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Duplicate role name for office' })
  async create(@Body() dto: CreateRoleDto) {
    const data = await this.rolesService.create(dto);
    return { message: 'Role created', data };
  }

  @RequirePermission('role', 'edit')
  @Put(':id')
  @ApiOperation({ summary: 'Update role' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoleDto,
  ) {
    const data = await this.rolesService.update(id, dto);
    return { message: 'Role updated', data };
  }

  @RequirePermission('role', 'delete')
  @Delete()
  @ApiOperation({ summary: 'Bulk delete by ids' })
  async bulkRemove(@Body() dto: BulkDeleteRoleDto) {
    const result = await this.rolesService.bulkRemove(dto);
    return { message: 'Roles deleted', data: result };
  }

  @RequirePermission('role', 'delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete one role' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.rolesService.remove(id);
    return { message: 'Role deleted', data: result };
  }
}
