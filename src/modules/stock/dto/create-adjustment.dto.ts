import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AdjustmentReason,
  AdjustmentType,
} from '../schemas/stock-adjustment.schema';

export class CreateAdjustmentDto {
  @ApiProperty()
  @IsMongoId()
  office_id!: string;

  @ApiProperty()
  @IsMongoId()
  product_id!: string;

  @ApiProperty({ enum: AdjustmentType })
  @IsEnum(AdjustmentType)
  type!: AdjustmentType;

  @ApiProperty({ enum: AdjustmentReason })
  @IsEnum(AdjustmentReason)
  reason!: AdjustmentReason;

  @ApiProperty({
    description:
      'Units to add or remove. For a recount it is the counted total on the shelf.',
    minimum: 0,
  })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
