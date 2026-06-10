import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/**
 * Global error envelope: { success: false, message, errors? }.
 * Validation errors (BadRequestException carrying an `errors` map) are
 * passed through with the field map intact.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly _httpAdapter: HttpAdapterHost) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const { httpAdapter } = this._httpAdapter;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const r = res as Record<string, unknown>;
        const rawMsg = r.message;
        // class-validator default puts an array in `message`; normalize
        if (typeof rawMsg === 'string') {
          message = rawMsg;
        } else if (Array.isArray(rawMsg)) {
          message = 'Validation failed';
        } else {
          message = exception.message;
        }
        if (r.errors) {
          errors = r.errors as Record<string, string[]>;
        }
      }
    } else {
      // log unexpected errors but don't leak internals to client
      console.error('Unhandled exception:', exception);
    }

    const payload: Record<string, unknown> = {
      success: false,
      statusCode: status,
      message,
    };
    if (errors) {
      payload.errors = errors;
    }

    httpAdapter.reply(ctx.getResponse(), payload, status);
  }
}
