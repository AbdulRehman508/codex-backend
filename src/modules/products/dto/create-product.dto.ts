import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductStatus, ProductUnit } from '../schemas/product.schema';

export class CreateProductDto {
  @ApiProperty({ description: 'Office the product belongs to' })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ example: 'Laptop Dell' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'SKU-1001', description: 'Unique per office' })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  sku!: string;

  @ApiPropertyOptional({ example: '8901234567890' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  )
  barcode?: string | null;

  @ApiProperty({ example: 1499.99, minimum: 0 })
  @Transform(({ value }) => (value === '' ? undefined : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 25, minimum: 0, default: 0 })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? 0 : parseInt(value as string, 10),
  )
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    example: 5,
    minimum: 0,
    default: 0,
    description:
      'Reorder level: at or below this the product is flagged low. 0 = use the office-wide threshold.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? 0 : parseInt(value as string, 10),
  )
  @IsInt()
  @Min(0)
  min_stock?: number;

  @ApiPropertyOptional({ enum: ProductUnit, default: ProductUnit.PCS })
  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  @ApiPropertyOptional({
    example: 24,
    minimum: 1,
    default: 1,
    description: 'Units in one supplier pack (carton of 24 => 24).',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? 1 : parseInt(value as string, 10),
  )
  @IsInt()
  @Min(1)
  pack_size?: number;

  @ApiPropertyOptional({ example: 'Business laptop, 16 GB RAM' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ProductStatus, default: ProductStatus.ACTIVE })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description:
      'Bin the product is stored in (rack_locations._id). Null = unassigned.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsMongoId()
  rack_location_id?: string | null;
}
