import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ReceivePaymentDto {
  @ApiProperty({ example: 5000, description: 'Paid towards the borrow balance' })
  @Transform(({ value }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ example: 'Cash at counter' })
  @IsOptional()
  @IsString()
  note?: string;
}
