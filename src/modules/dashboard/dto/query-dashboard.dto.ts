import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class QueryDashboardDto {
  @ApiPropertyOptional({ description: 'Office the numbers are scoped to' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({
    description: 'Period start (ISO instant). Defaults to the start of today.',
    example: '2026-09-11T19:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({
    description: 'Period end, exclusive (ISO instant). Defaults to now.',
  })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({
    description:
      'IANA timezone the chart buckets are cut in, e.g. Asia/Karachi. Defaults to UTC.',
    example: 'Asia/Karachi',
  })
  @IsOptional()
  @IsString()
  tz?: string;

  @ApiPropertyOptional({
    description: 'Products at or below this quantity count as low stock',
    default: 5,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  @Max(10000)
  low_stock: number = 5;
}
