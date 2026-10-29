import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MarkReadDto, QueryNotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * The bell, for the branch picked in the header.
 *
 * No permission key guards this: a notification carries no figures, only the
 * news that something happened in a branch the user already works at, and the
 * screen it links to enforces its own access. The office-scope guard still
 * applies, so nobody reads another branch's bell.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "A branch's notifications, newest first" })
  async findAll(@Query() query: QueryNotificationDto) {
    const data = await this.notifications.findAll(query);
    return { message: 'Notifications fetched', data };
  }

  @Get('count')
  @ApiOperation({ summary: 'How many are unread' })
  async count(@Query('office_id') officeId?: string) {
    const unread = await this.notifications.unreadCount(officeId);
    return { message: 'Unread count fetched', data: { unread } };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark the whole bell read' })
  async readAll(@Body() dto: MarkReadDto) {
    const data = await this.notifications.markAllRead(dto.office_id);
    return { message: 'Notifications marked read', data };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification read' })
  async read(@Param('id') id: string, @Body() dto: MarkReadDto) {
    const data = await this.notifications.markRead(id, dto.office_id);
    return { message: 'Notification marked read', data };
  }
}
