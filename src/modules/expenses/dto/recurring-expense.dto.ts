import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
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
import { RecurringFrequency } from '../schemas/recurring-expense.schema';

export class CreateRecurringExpenseDto {
  @ApiProperty()
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ example: 'Rent' })
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

  @ApiPropertyOptional({ enum: ExpensePaymentMethod })
  @IsOptional()
  @IsEnum(ExpensePaymentMethod)
  payment_method?: ExpensePaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paid_to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ enum: RecurringFrequency, default: RecurringFrequency.MONTHLY })
  @IsOptional()
  @IsEnum(RecurringFrequency)
  frequency?: RecurringFrequency;

  @ApiProperty({
    description: '1-31 for a monthly bill, 0 (Sunday) to 6 for a weekly one',
    minimum: 0,
    maximum: 31,
  })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  @Max(31)
  day!: number;

  @ApiPropertyOptional({
    description:
      'First date it is due. Defaults to the next matching date; a past date backfills the bills since then.',
  })
  @IsOptional()
  @IsDateString()
  start_from?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  active?: boolean;
}

export class UpdateRecurringExpenseDto extends PartialType(
  CreateRecurringExpenseDto,
) {}
