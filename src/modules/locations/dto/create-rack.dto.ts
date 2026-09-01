import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { RackStatus } from '../schemas/rack.schema';

// Guard rails for bin generation: rows * columns * bins may not exceed this.
export const MAX_ROWS = 100;
export const MAX_COLUMNS = 100;
export const MAX_BINS = 100;
export const MAX_GENERATED_LOCATIONS = 5000;

export class CreateRackDto {
  @ApiProperty({ description: 'Office the rack belongs to' })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ example: 'Rack A' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'RACK-A',
    description: 'Unique per office. Letters, digits, dash and underscore only',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'code may only contain letters, digits, - and _',
  })
  code!: string;

  @ApiPropertyOptional({ example: 'Cold storage rack, aisle 3' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: RackStatus, default: RackStatus.ACTIVE })
  @IsOptional()
  @IsEnum(RackStatus)
  status?: RackStatus;

  @ApiProperty({ example: 5, minimum: 1, maximum: MAX_ROWS })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(MAX_ROWS)
  rows_count!: number;

  @ApiProperty({ example: 4, minimum: 1, maximum: MAX_COLUMNS })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(MAX_COLUMNS)
  columns_count!: number;

  @ApiProperty({ example: 3, minimum: 1, maximum: MAX_BINS })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(MAX_BINS)
  bins_count!: number;
}
