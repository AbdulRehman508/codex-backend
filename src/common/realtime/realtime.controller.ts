import { BadRequestException, Controller, Query, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { isValidObjectId } from 'mongoose';
import { Observable } from 'rxjs';
import { RawResponse } from '../decorators/raw-response.decorator';
import { RealtimeService, SseMessage } from './realtime.service';

@ApiTags('realtime')
@ApiBearerAuth()
@Controller('events')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * The open line a screen keeps to its branch.
   *
   * `office_id` is checked by the office-scope guard like any other call, so a
   * user cannot listen in on a branch they do not work at. Auth rides on the
   * session cookie, which is what EventSource can send — it cannot set headers.
   */
  @RawResponse()
  @Sse()
  @ApiOperation({ summary: 'Server-sent events for one branch' })
  @ApiQuery({ name: 'office_id', required: true })
  stream(@Query('office_id') officeId: string): Observable<SseMessage> {
    if (!officeId || !isValidObjectId(officeId)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['office_id must be a valid id'] },
      });
    }
    return this.realtime.streamFor(String(officeId));
  }
}
