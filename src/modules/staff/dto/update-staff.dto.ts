import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { CreateStaffDto } from './create-staff.dto';

// All Create fields optional, EXCEPT password — re-declared so that an
// omitted/empty password means "keep existing" instead of failing the policy.
// Used for both PUT (full) and PATCH (partial); PUT semantics enforced by the
// client sending the whole object.
export class UpdateStaffDto extends PartialType(
  OmitType(CreateStaffDto, ['password'] as const),
) {
  @ApiPropertyOptional({
    description:
      'Omit or send empty to keep the current password. Otherwise: min 12 chars, ≥1 uppercase, ≥1 digit, ≥1 special char.',
  })
  @ValidateIf(
    (o: UpdateStaffDto) => o.password !== undefined && o.password !== '',
  )
  @IsString()
  @MinLength(12, { message: 'password must be at least 12 characters' })
  @Matches(/[A-Z]/, {
    message: 'password must contain at least one uppercase letter',
  })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  @Matches(/[!@#$%^&*(),.?":{}|<>]/, {
    message: 'password must contain at least one special character',
  })
  password?: string;
}
