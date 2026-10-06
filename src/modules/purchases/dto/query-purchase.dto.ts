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
import { PurchaseStatus } from '../schemas/purchase.schema';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const SORTABLE = [
  'purchase_no',
  'supplier_name',
  'items_count',
  'total',
  'paid_amount',
  'due_amount',
  'status',
  'created_at',
];

export class QueryPurchaseDto {
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

  @ApiPropertyOptional({ description: 'Matches purchase_no, supplier name, their invoice no' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({ description: 'Only this supplier' })
  @IsOptional()
  @IsMongoId()
  supplier_id?: string;

  @ApiPropertyOptional({ enum: PurchaseStatus })
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;

  @ApiPropertyOptional({ description: 'Only bills with something still payable' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  due_only?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: `One of: ${SORTABLE.join(', ')}`, default: 'created_at' })
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
