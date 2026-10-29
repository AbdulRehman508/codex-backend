import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

export class QueryNotificationDto {
  @ApiPropertyOptional({ description: 'The branch whose bell this is' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Only the ones nobody has read yet' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unread_only?: boolean;
}

export class MarkReadDto {
  @ApiPropertyOptional({ description: 'The branch whose bell is being cleared' })
  @IsOptional()
  @IsMongoId()
  office_id?: string;
}
