import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPass@123' })
  @IsString()
  @IsNotEmpty()
  current_password!: string;

  @ApiProperty({ example: 'NewStrongPass@123' })
  @IsStrongPassword()
  new_password!: string;
}
