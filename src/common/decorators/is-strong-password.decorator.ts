import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MinLength } from 'class-validator';

// Shared password policy: min 12 chars, >=1 upper, >=1 digit, >=1 special.
export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(12, { message: 'password must be at least 12 characters' }),
    Matches(/[A-Z]/, {
      message: 'password must contain at least one uppercase letter',
    }),
    Matches(/\d/, { message: 'password must contain at least one digit' }),
    Matches(/[!@#$%^&*(),.?":{}|<>]/, {
      message: 'password must contain at least one special character',
    }),
  );
}
