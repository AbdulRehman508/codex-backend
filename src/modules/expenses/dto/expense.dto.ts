import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExpensePaymentMethod } from '../schemas/expense.schema';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class CreateExpenseDto {
  @ApiProperty({ description: 'The branch that spent the money' })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ example: 'Rent', description: 'Free text: a shop may use its own' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  category!: string;

  @ApiProperty({ minimum: 0 })
  @Transform(({ value }) => (value === '' || value === null ? 0 : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ enum: ExpensePaymentMethod, default: ExpensePaymentMethod.CASH })
  @IsOptional()
  @IsEnum(ExpensePaymentMethod)
  payment_method?: ExpensePaymentMethod;

  @ApiPropertyOptional({
    description: 'When the money went out. Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  spent_at?: string;

  @ApiPropertyOptional({ description: 'Who was paid' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paid_to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Photo of the bill, as a base64 data URL' })
  @IsOptional()
  @IsString()
  receipt?: string;
}

/** Everything is editable: a typo in an amount should be fixable. */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class QueryExpenseDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({ description: 'Exact category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ExpensePaymentMethod })
  @IsOptional()
  @IsEnum(ExpensePaymentMethod)
  payment_method?: ExpensePaymentMethod;

  @ApiPropertyOptional({ description: 'Category, note, payee or expense number' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Period start (ISO instant)' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Period end (ISO instant)' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ default: 'spent_at' })
  @IsOptional()
  @IsString()
  sort: string = 'spent_at';

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}
