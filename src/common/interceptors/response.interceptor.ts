import {
  CallHandler,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

interface Envelope<T> {
  success: true;
  message: string;
  data: T;
}

/**
 * Wraps every successful controller return into { success, message, data }.
 * Controllers return { message?, data } — message defaults if absent.
 *
 * A route marked `@RawResponse()` is passed through untouched: a server-sent
 * event stream carries its own shape and must not be wrapped per tick.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  any,
  Envelope<T> | unknown
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Envelope<T> | unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    return next.handle().pipe(
      map((payload: unknown) => {
        if (
          payload &&
          typeof payload === 'object' &&
          'data' in payload &&
          'message' in payload
        ) {
          const p = payload as { message: string; data: T };
          return { success: true, message: p.message, data: p.data };
        }
        return { success: true, message: 'OK', data: payload as T };
      }),
    );
  }
}
