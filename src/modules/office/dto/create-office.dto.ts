import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OfficePaymentMethodDto {
  @ApiProperty({ example: 'JazzCash' })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({ example: 'Pak Loam Store' })
  @IsString()
  @IsNotEmpty()
  account_title!: string;

  @ApiProperty({ example: '03001234567', description: 'Wallet no, IBAN or Raast ID' })
  @IsString()
  @IsNotEmpty()
  account_number!: string;

  @ApiPropertyOptional({
    description:
      "Provider's merchant QR: a base64 data URL to upload, the stored URL to keep it, or null to drop it",
  })
  @IsOptional()
  @IsString()
  qr_image?: string | null;
}
import {
  // MembershipLevel,
  // MembershipType,
  OfficeStatus,
} from '../schemas/office.schema';

export class CreateOfficeDto {
  @ApiProperty({ example: 'Downtown Office' })
  @IsString()
  @IsNotEmpty()
  office_name!: string;

  @ApiProperty({ example: 'office@example.com' })
  @IsEmail()
  @IsNotEmpty()
  office_email!: string;

  @ApiProperty({ example: '+61400000000' })
  @IsString()
  @IsNotEmpty()
  office_mobile_no!: string;

  // @ApiProperty({ enum: MembershipLevel, example: MembershipLevel.GOLD })
  // @IsEnum(MembershipLevel)
  // membership_level!: MembershipLevel;

  // @ApiProperty({ enum: MembershipType, example: MembershipType.MONTHLY })
  // @IsEnum(MembershipType)
  // membership_type!: MembershipType;

  @ApiPropertyOptional({ example: 'LIC-12345' })
  @IsOptional()
  @IsString()
  licence_no?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  approved?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Head office. Setting it clears the flag on every other office',
  })
  @IsOptional()
  @IsBoolean()
  is_main?: boolean;

  @ApiPropertyOptional({ enum: OfficeStatus, default: OfficeStatus.ACTIVE })
  @IsOptional()
  @IsEnum(OfficeStatus)
  office_status?: OfficeStatus;

  @ApiProperty({ example: '123 Main St, Sydney NSW' })
  @IsString()
  @IsNotEmpty()
  office_address!: string;

  @ApiPropertyOptional({ example: 'Long biography text...' })
  @IsOptional()
  @IsString()
  biography?: string;

  @ApiPropertyOptional({
    description: 'Base64 image data URL, e.g. data:image/png;base64,iVBORw0...',
    example:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  })
  @IsOptional()
  @IsString()
  office_logo?: string;

  @ApiPropertyOptional({
    type: [OfficePaymentMethodDto],
    description: 'Online payment options; the whole list replaces the stored one',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OfficePaymentMethodDto)
  payment_methods?: OfficePaymentMethodDto[];

  // ---- sales tax ----

  @ApiPropertyOptional({
    default: false,
    description: 'Charge sales tax on this branch\'s bills',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  tax_enabled?: boolean;

  @ApiPropertyOptional({ example: 'GST', default: 'Tax' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  tax_name?: string;

  @ApiPropertyOptional({ example: 17, minimum: 0, maximum: 100, default: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? 0 : Number(value)))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  tax_rate?: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Shelf prices already include the tax',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  tax_inclusive?: boolean;

  @ApiPropertyOptional({ example: '1234567-8', description: 'Printed on the bill' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tax_number?: string;
}
