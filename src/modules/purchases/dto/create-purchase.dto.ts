import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PurchaseStatus } from '../schemas/purchase.schema';

export class PurchaseLineDto {
  @ApiProperty({ description: 'Product being received' })
  @IsMongoId()
  product_id!: string;

  @ApiProperty({ example: 20, minimum: 1 })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 180.5, description: 'What one unit cost' })
  @Transform(({ value }) => (value === '' || value === null ? 0 : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost_price!: number;

  @ApiPropertyOptional({
    example: 'B-2291',
    description: 'Supplier batch / lot number, for goods that carry one',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  batch_no?: string;

  @ApiPropertyOptional({
    example: '2027-03-31',
    description: 'When this lot expires. Feeds the expiry report.',
  })
  @IsOptional()
  @IsDateString()
  expiry_date?: string;
}

export class CreatePurchaseDto {
  @ApiProperty({ description: 'Office the stock arrives at' })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ description: 'Who supplied it' })
  @IsMongoId()
  supplier_id!: string;

  @ApiPropertyOptional({ description: "The supplier's own bill number" })
  @IsOptional()
  @IsString()
  supplier_invoice_no?: string;

  @ApiProperty({ type: [PurchaseLineDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? 0 : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ description: 'Paid now; the rest becomes payable' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  paid_amount?: number;

  @ApiPropertyOptional({ enum: PurchaseStatus, default: PurchaseStatus.RECEIVED })
  @IsOptional()
  @IsEnum(PurchaseStatus)
  status?: PurchaseStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
