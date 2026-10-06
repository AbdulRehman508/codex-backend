import { ApiPropertyOptional } from '@nestjs/swagger';
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
import {
  AdjustmentReason,
  AdjustmentType,
} from '../schemas/stock-adjustment.schema';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const SORTABLE = [
  'product_name',
  'type',
  'reason',
  'quantity',
  'after_quantity',
  'created_at',
];

export class QueryAdjustmentDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 200 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 10;

  @ApiPropertyOptional({ description: 'Matches product name, sku or note' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({ description: 'Only movements of this product' })
  @IsOptional()
  @IsMongoId()
  product_id?: string;

  @ApiPropertyOptional({ enum: AdjustmentType })
  @IsOptional()
  @IsEnum(AdjustmentType)
  type?: AdjustmentType;

  @ApiPropertyOptional({ enum: AdjustmentReason })
  @IsOptional()
  @IsEnum(AdjustmentReason)
  reason?: AdjustmentReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({
    description: `One of: ${SORTABLE.join(', ')}`,
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
