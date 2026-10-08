import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AdminOnly } from '../permissions/permissions.decorator';
import type { TrashModule } from './trash.service';
import { TRASH_MODULES, TrashService } from './trash.service';

export class QueryTrashDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 25;

  @ApiPropertyOptional({ enum: TRASH_MODULES })
  @IsOptional()
  @IsEnum(TRASH_MODULES.reduce((a, k) => ({ ...a, [k]: k }), {}), {
    message: `module must be one of: ${TRASH_MODULES.join(', ')}`,
  })
  module?: TrashModule;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

@ApiTags('trash')
@ApiBearerAuth()
@Controller('trash')
export class TrashController {
  constructor(private readonly trashService: TrashService) {}

  // bringing a deleted record back is an owner's call, not a cashier's
  @AdminOnly()
  @Get()
  @ApiOperation({
    summary: 'Deleted records that can be put back (admin only)',
  })
  async findAll(@Query() query: QueryTrashDto) {
    const data = await this.trashService.findAll(query);
    return { message: 'Trash fetched', data };
  }

  @AdminOnly()
  @Post(':module/:id/restore')
  @ApiOperation({ summary: 'Put a deleted record back' })
  @ApiResponse({ status: 409, description: 'A live record holds its unique value' })
  async restore(@Param('module') module: string, @Param('id') id: string) {
    const data = await this.trashService.restore(module, id);
    return { message: 'Record restored', data };
  }

  @AdminOnly()
  @Delete(':module/:id')
  @ApiOperation({ summary: 'Delete for good — there is nothing after this' })
  async purge(@Param('module') module: string, @Param('id') id: string) {
    const data = await this.trashService.purge(module, id);
    return { message: 'Record permanently deleted', data };
  }
}
