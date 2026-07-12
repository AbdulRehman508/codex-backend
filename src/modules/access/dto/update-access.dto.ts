import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ModulePermissionDto {
  @ApiProperty({ example: 'dashboard', description: 'Module catalog key' })
  @IsString()
  @IsNotEmpty()
  module!: string;

  @ApiProperty({ default: false })
  @IsOptional()
  @IsBoolean()
  view?: boolean;

  @ApiProperty({ default: false })
  @IsOptional()
  @IsBoolean()
  create?: boolean;

  @ApiProperty({ default: false })
  @IsOptional()
  @IsBoolean()
  edit?: boolean;

  @ApiProperty({ default: false })
  @IsOptional()
  @IsBoolean()
  delete?: boolean;
}

export class UpdateAccessDto {
  @ApiProperty({ type: [ModulePermissionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModulePermissionDto)
  permissions!: ModulePermissionDto[];
}
