import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AdminOnly } from '../permissions/permissions.decorator';
import { AuditAction } from './audit-log.schema';
import { AuditService } from './audit.service';

export class QueryAuditDto {
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

  @ApiPropertyOptional({ description: 'Matches user, record label, module or path' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  user_id?: string;

  @ApiPropertyOptional({ description: 'Access-catalog key, e.g. products' })
  @IsOptional()
  @IsString()
  module?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_to?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // the trail spans every branch and every user, so it is the owner's view
  @AdminOnly()
  @Get()
  @ApiOperation({ summary: 'Who changed what, newest first (admin only)' })
  async findAll(@Query() query: QueryAuditDto) {
    const data = await this.auditService.findAll(query);
    return { message: 'Audit log fetched', data };
  }
}
