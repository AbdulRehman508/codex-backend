import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ProductStatus } from '../../products/schemas/product.schema';
import { PaymentMethod, SaleStatus } from '../../sales/schemas/sale.schema';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** Filters every report understands. */
export class BaseReportDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 5000 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(5000)
  limit: number = 25;

  @ApiPropertyOptional({ description: 'Office the report is scoped to' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({ description: 'Period start (ISO instant)' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Period end (ISO instant)' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}

export class SalesReportDto extends BaseReportDto {
  @ApiPropertyOptional({ enum: SaleStatus })
  @IsOptional()
  @IsEnum(SaleStatus)
  status?: SaleStatus;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  payment_method?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Only bills that still carry a borrow' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  borrow_only?: boolean;
}

export class StockReportDto extends BaseReportDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ description: 'Units at or below this count are "low"', default: 5 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  low_stock: number = 5;

  @ApiPropertyOptional({ description: 'Only products at or below the low-stock mark' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  low_only?: boolean;
}

/** A single day's close-out, in the viewer's own timezone. */
export class DayCloseDto {
  @ApiPropertyOptional({ description: 'Office the day belongs to' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({
    description: 'The day to close, yyyy-MM-dd. Defaults to today.',
  })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone the day is measured in, e.g. Asia/Karachi',
    default: 'UTC',
  })
  @IsOptional()
  @IsString()
  tz?: string;
}

/** Lots running out of date, or already past it. */
export class ExpiryReportDto extends BaseReportDto {
  @ApiPropertyOptional({
    description: 'Flag lots expiring within this many days',
    default: 30,
    minimum: 0,
    maximum: 365,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  @Max(365)
  within_days: number = 30;

  @ApiPropertyOptional({ description: 'Only lots already past their date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  expired_only?: boolean;
}
