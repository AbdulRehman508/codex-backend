import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
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

  @Get('offices')
  @ApiOperation({
    summary: 'Offices the caller may work in (all of them for an admin)',
  })
  async listOffices(@CurrentUser('sub') userId: string) {
    const data = await this.profileService.listOffices(userId);
    return { message: 'Offices fetched', data };
  }

  /**
   * The caller's own rules, in one branch.
   *
   * This is deliberately not behind `access_control`: that key is for editing
   * *other* roles' matrices. A manager has to be able to read their own, or
   * the UI would have to fail closed and hide every screen from them.
   */
  @Get('permissions')
  @ApiOperation({ summary: "The caller's permissions in one office" })
  @ApiQuery({ name: 'office_id', required: false })
  async permissions(
    @CurrentUser('sub') userId: string,
    @Query('office_id') officeId?: string,
  ) {
    const data = await this.profileService.permissionsFor(userId, officeId);
    return { message: 'Permissions fetched', data };
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
