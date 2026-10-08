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

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const SORTABLE = [
  'transfer_no',
  'from_office_name',
  'to_office_name',
  'items_count',
  'units',
  'created_at',
];

export class QueryTransferDto {
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

  @ApiPropertyOptional({ description: 'Matches transfer no, office name, product or note' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Transfers touching this office — sent or received',
  })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({
    description: 'With office_id: "in" received only, "out" sent only',
    enum: ['in', 'out'],
  })
  @IsOptional()
  @IsEnum({ in: 'in', out: 'out' }, { message: 'direction must be in or out' })
  direction?: 'in' | 'out';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ description: 'Include soft-deleted (reversed) transfers' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  include_deleted?: boolean;

  @ApiPropertyOptional({
    description: `One of: ${SORTABLE.join(', ')}`,
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
