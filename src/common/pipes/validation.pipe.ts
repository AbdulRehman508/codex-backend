import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

function flatten(
  errors: ValidationError[],
  parent = '',
): Record<string, string[]> {
  const acc: Record<string, string[]> = {};
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      acc[field] = Object.values(err.constraints);
    }
    if (err.children?.length) {
      Object.assign(acc, flatten(err.children, field));
    }
  }
  return acc;
}

// ValidationPipe wired to emit { message, errors: { field: [...] } } on 400.
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        message: 'Validation failed',
        errors: flatten(errors),
      }),
  });
}
