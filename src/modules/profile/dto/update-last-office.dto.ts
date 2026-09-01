import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional, ValidateIf } from 'class-validator';

/**
 * Remembers which office the user last picked in the header, so the next
 * login lands on it. `null` clears the remembered office.
 */
export class UpdateLastOfficeDto {
  @ApiPropertyOptional({
    description: 'Office id to remember, or null to forget it',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsMongoId()
  office_id?: string | null;
}
