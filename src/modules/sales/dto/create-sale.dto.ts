import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, SaleStatus } from '../schemas/sale.schema';

export class SaleLineDto {
  @ApiProperty({ description: 'Product being sold' })
  @IsMongoId()
  product_id!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    description: 'Unit price override; defaults to the product price',
    example: 1499.99,
  })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;
}

export class CreateSaleDto {
  @ApiProperty({ description: 'Office the sale belongs to' })
  @IsMongoId()
  office_id!: string;

  @ApiPropertyOptional({ example: 'Ali Hassan', default: 'Walk-in' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  customer_name?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH })
  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;

  @ApiProperty({ type: [SaleLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[];

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? 0 : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ enum: SaleStatus, default: SaleStatus.COMPLETED })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;
}
