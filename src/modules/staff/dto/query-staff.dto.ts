import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const SORTABLE = [
  'first_name',
  'email',
  'mobile_no',
  'staff_status',
  'created_at',
  'updated_at',
];

export class QueryStaffDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  limit: number = 10;

  @ApiPropertyOptional({
    description: 'Matches first_name, last_name, email, mobile_no',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by role_id' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  role_id?: number;

  @ApiPropertyOptional({
    description: `Sort field. One of: ${SORTABLE.join(', ')}`,
    default: 'created_at',
  })
  @IsOptional()
  @IsString()
  @IsEnum(SORTABLE.reduce((a, k) => ({ ...a, [k]: k }), {}), {
    message: `sort must be one of: ${SORTABLE.join(', ')}`,
  })
  sort: string = 'created_at';

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}
