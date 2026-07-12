import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessService } from './access.service';
import { UpdateAccessDto } from './dto/update-access.dto';

@ApiTags('access')
@ApiBearerAuth()
@Controller('access')
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  // declared before ':roleId' so /access/modules isn't parsed as an id
  @Get('modules')
  @ApiOperation({ summary: 'List controllable module catalog' })
  getModules() {
    return { message: 'Modules fetched', data: this.accessService.getModules() };
  }

  @Get(':roleId')
  @ApiOperation({ summary: 'Get the permission matrix for a role' })
  async getForRole(@Param('roleId', ParseIntPipe) roleId: number) {
    const data = await this.accessService.getForRole(roleId);
    return { message: 'Access fetched', data };
  }

  @Put(':roleId')
  @ApiOperation({ summary: 'Save the permission matrix for a role' })
  async save(
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() dto: UpdateAccessDto,
  ) {
    const data = await this.accessService.saveForRole(roleId, dto);
    return { message: 'Access updated', data };
  }
}
