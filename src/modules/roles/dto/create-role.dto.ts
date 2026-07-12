import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'Manager' })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiPropertyOptional({ example: 'Handles day-to-day office operations' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '665f1c2a9e8b3d0012a4b5c6' })
  @IsMongoId()
  @IsNotEmpty()
  office_id!: string;
}
