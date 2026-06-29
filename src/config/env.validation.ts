import { plainToInstance } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

// Fail-fast schema: app refuses to boot if required env is missing/invalid.
class EnvironmentVariables {
  @IsOptional()
  @IsNumber()
  PORT?: number;

  @IsOptional()
  @IsString()
  APP_URL?: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_HOST!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_PORT!: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_NAME!: string;

  @IsString()
  @MinLength(8, { message: 'JWT_SECRET must be at least 8 chars' })
  JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES?: string;

  @IsOptional()
  @IsString()
  JWT_REMEMBER_EXPIRES?: string;

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return validated;
}
