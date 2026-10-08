import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TransferLineDto {
  @ApiProperty({ description: "The sending office's product" })
  @IsMongoId()
  product_id!: string;

  @ApiProperty({ minimum: 1 })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateTransferDto {
  @ApiProperty({
    description: 'Office the stock leaves (named office_id so the scope guard sees it)',
  })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ description: 'Office the stock arrives at' })
  @IsMongoId()
  to_office_id!: string;

  @ApiProperty({ type: [TransferLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
