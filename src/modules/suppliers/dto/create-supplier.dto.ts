import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { SupplierStatus } from '../schemas/supplier.schema';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateSupplierDto {
  @ApiProperty({ description: 'Office the supplier belongs to' })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ example: 'Imran Traders' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Imran & Sons (Pvt) Ltd' })
  @IsOptional()
  @IsString()
  company?: string;

  @ApiProperty({ example: '03001234567' })
  @IsString()
  @IsNotEmpty()
  mobile_no!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsEmail()
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: SupplierStatus, default: SupplierStatus.ACTIVE })
  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}
