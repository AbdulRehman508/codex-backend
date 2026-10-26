import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StockRequestStatus } from '../schemas/stock-request.schema';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** Which side of a request a list is about. */
export enum RequestDirection {
  /** we asked another branch */
  OUTGOING = 'outgoing',
  /** another branch asked us */
  INCOMING = 'incoming',
}

export class RequestLineDto {
  @ApiProperty({ description: "The holding office's product" })
  @IsMongoId()
  product_id!: string;

  @ApiProperty({ minimum: 1 })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateStockRequestDto {
  @ApiProperty({
    description:
      'The branch that needs the stock — named office_id so the scope guard checks the caller belongs to it',
  })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({
    description:
      'The branch being asked. Deliberately not called *_office_id the guard knows: the requester is not assigned there, which is the whole point of asking.',
  })
  @IsMongoId()
  source_office_id!: string;

  @ApiProperty({ type: [RequestLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequestLineDto)
  lines!: RequestLineDto[];

  @ApiPropertyOptional({ description: 'Why the stock is needed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DeclineStockRequestDto {
  @ApiProperty({
    description: 'Why the request is refused — the requester is owed an answer',
    minLength: 3,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class QueryStockRequestDto {
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

  @ApiPropertyOptional({ description: 'The branch whose requests these are' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({
    enum: RequestDirection,
    description: 'Outgoing: we asked. Incoming: we were asked. Omit for both.',
  })
  @IsOptional()
  @IsEnum(RequestDirection)
  direction?: RequestDirection;

  @ApiPropertyOptional({ enum: StockRequestStatus })
  @IsOptional()
  @IsEnum(StockRequestStatus)
  status?: StockRequestStatus;

  @ApiPropertyOptional({ description: 'Request number, product or branch name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 'created_at' })
  @IsOptional()
  @IsString()
  sort: string = 'created_at';

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}

/** The picker: what the holding branch actually has on its shelves. */
export class AvailableStockDto {
  @ApiProperty({ description: 'The branch being asked' })
  @IsMongoId()
  source_office_id!: string;

  @ApiPropertyOptional({ description: 'Name or SKU' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}
