import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { StaffStatus } from '../schemas/staff.schema';

// Pakistani CNIC: XXXXX-XXXXXXX-X (5-7-1 digits)
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export class CreateStaffDto {
  @ApiProperty({ example: 'Ali' })
  @IsString()
  @IsNotEmpty()
  first_name!: string;

  @ApiProperty({ example: 'Khan' })
  @IsString()
  @IsNotEmpty()
  last_name!: string;

  @ApiProperty({ example: 'ali@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: 'StrongPass@123',
    description:
      'Min 12 chars, ≥1 uppercase, ≥1 digit, ≥1 special char !@#$%^&*(),.?":{}|<>',
  })
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @Matches(/[A-Z]/, {
    message: 'password must contain at least one uppercase letter',
  })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  @Matches(/[!@#$%^&*(),.?":{}|<>]/, {
    message: 'password must contain at least one special character',
  })
  password!: string;

  @ApiProperty({ example: '03001234567' })
  @IsString()
  @IsNotEmpty()
  mobile_no!: string;

  @ApiProperty({ example: '35202-1234567-1' })
  @IsString()
  @Matches(CNIC_RE, {
    message: 'cnic_no must match the format XXXXX-XXXXXXX-X',
  })
  cnic_no!: string;

  @ApiProperty({
    type: [String],
    example: ['665f1c2e8b3a4c1d2e3f4a5b', '665a9d3f7c2b1e0a4d5c6b7a'],
    description: 'One or more office ids the staff belongs to',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'at least one office is required' })
  @IsMongoId({ each: true, message: 'each office_id must be a valid id' })
  office_ids!: string[];

  @ApiProperty({ example: 2 })
  @IsInt({ message: 'role_id must be an integer' })
  role_id!: number;

  @ApiProperty({ example: 'Lahore' })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiProperty({ example: 50000 })
  @IsNumber({}, { message: 'salary must be a number' })
  @Min(0, { message: 'salary must be 0 or greater' })
  salary!: number;

  @ApiPropertyOptional({ example: 'Senior agent, 5 years experience' })
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
  profile_photo?: string | null;

  @ApiPropertyOptional({ enum: StaffStatus, default: StaffStatus.ACTIVE })
  @IsOptional()
  @IsEnum(StaffStatus)
  staff_status?: StaffStatus;
}
