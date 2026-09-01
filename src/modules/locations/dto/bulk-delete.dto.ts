import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsMongoId } from 'class-validator';

export class BulkDeleteDto {
  @ApiProperty({ type: [String], example: ['665f1c...', '665f1d...'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsMongoId({ each: true })
  ids!: string[];
}
