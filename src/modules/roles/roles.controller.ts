import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'List roles for one or more offices (dropdown)' })
  @ApiQuery({
    name: 'office_id',
    required: false,
    description: 'Comma-separated office ids',
  })
  async findAll(@Query('office_id') officeId?: string) {
    const officeIds = officeId
      ? officeId.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const data = await this.rolesService.findAll(officeIds);
    return { message: 'Roles fetched', data };
  }
}
