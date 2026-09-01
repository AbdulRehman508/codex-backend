import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductStatus } from '../schemas/product.schema';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const SORTABLE = [
  'name',
  'sku',
  'barcode',
  'price',
  'quantity',
  'status',
  'created_at',
  'updated_at',
];

export class QueryProductDto {
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

  @ApiPropertyOptional({ description: 'Matches name, sku and barcode' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by office id (required scope)' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({ description: 'Filter by rack' })
  @IsOptional()
  @IsMongoId()
  rack_id?: string;

  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

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
