import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateLastOfficeDto } from './dto/update-last-office.dto';
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

  @Put('last-office')
  @ApiOperation({
    summary: 'Remember the office picked in the header (auto-selected on login)',
  })
  async setLastOffice(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateLastOfficeDto,
  ) {
    const data = await this.profileService.setLastOffice(userId, dto.office_id);
    return { message: 'Last office saved', data };
  }
}
