import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

// Pakistani CNIC: XXXXX-XXXXXXX-X (5-7-1 digits)
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

/**
 * Self-editable profile fields only. Read-only fields (email, role_id,
 * office_id, staff_status, password, id) are intentionally absent — the
 * global whitelist validation pipe strips them if a client sends them.
 */
export class UpdateProfileDto {
  @ApiProperty({ example: 'Ali' })
  @IsString()
  @IsNotEmpty()
  first_name!: string;

  @ApiProperty({ example: 'Khan' })
  @IsString()
  @IsNotEmpty()
  last_name!: string;

  @ApiProperty({ example: '03001234567' })
  @IsString()
  @IsNotEmpty()
  mobile_no!: string;

  @ApiProperty({ example: '35202-1234567-1' })
  @IsString()
  @Matches(CNIC_RE, { message: 'cnic_no must match the format XXXXX-XXXXXXX-X' })
  cnic_no!: string;

  @ApiProperty({ example: 'Lahore' })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiPropertyOptional({ example: 'Senior agent, 5 years experience' })
  @IsOptional()
  @IsString()
  biography?: string;

  @ApiPropertyOptional({
    description: 'Base64 image data URL; omit/null/empty to keep existing photo',
  })
  @IsOptional()
  @IsString()
  profile_photo?: string | null;
}
