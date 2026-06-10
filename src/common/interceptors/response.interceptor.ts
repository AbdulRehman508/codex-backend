import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

interface Envelope<T> {
  success: true;
  message: string;
  data: T;
}

/**
 * Wraps every successful controller return into { success, message, data }.
 * Controllers return { message?, data } — message defaults if absent.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  any,
  Envelope<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<Envelope<T>> {
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
