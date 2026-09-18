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
import { CustomerStatus } from '../schemas/customer.schema';

/** Empty strings from the form mean "not provided", not "set it to empty". */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateCustomerDto {
  @ApiProperty({ description: 'Office the customer belongs to' })
  @IsMongoId()
  office_id!: string;

  @ApiProperty({ example: 'Ali' })
  @IsString()
  @IsNotEmpty()
  first_name!: string;

  @ApiProperty({ example: 'Hassan' })
  @IsString()
  @IsNotEmpty()
  last_name!: string;

  @ApiPropertyOptional({ example: 'ali@example.com', nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, value) => value !== null && value !== undefined)
  @IsEmail()
  email?: string | null;

  @ApiProperty({ example: '+923001234567' })
  @IsString()
  @IsNotEmpty()
  mobile_no!: string;

  @ApiPropertyOptional({ example: '35202-1234567-1', nullable: true })
  @IsOptional()
  @Transform(emptyToNull)
  @ValidateIf((_o, value) => value !== null && value !== undefined)
  @IsString()
  cnic_no?: string | null;

  @ApiPropertyOptional({ example: '12 Mall Road, Lahore' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Regular wholesale buyer' })
  @IsOptional()
  @IsString()
  biography?: string;

  @ApiPropertyOptional({ enum: CustomerStatus, default: CustomerStatus.ACTIVE })
  @IsOptional()
  @IsEnum(CustomerStatus)
  customer_status?: CustomerStatus;

  @ApiPropertyOptional({
    description: 'Base64 image data URL; omit/null to keep the existing photo',
  })
  @IsOptional()
  @IsString()
  profile_photo?: string;
}
