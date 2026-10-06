import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PaySupplierDto {
  @ApiProperty({ example: 5000, description: 'Paid against the payable balance' })
  @Transform(({ value }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ example: 'Cash on delivery' })
  @IsOptional()
  @IsString()
  note?: string;
}
