import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user profile' })
  async getProfile(@CurrentUser('sub') userId: string) {
    const data = await this.profileService.getProfile(userId);
    return { message: 'Profile fetched', data };
  }

  @Put()
  @ApiOperation({ summary: 'Update own editable profile fields' })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const data = await this.profileService.updateProfile(userId, dto);
    return { message: 'Profile updated', data };
  }
}
