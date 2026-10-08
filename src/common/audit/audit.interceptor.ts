import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { JwtUser } from '../decorators/current-user.decorator';
import { AuditAction } from './audit-log.schema';
import { AuditService } from './audit.service';

/** First path segment -> the access-catalog key the change belongs to. */
const MODULE_BY_SEGMENT: Record<string, string> = {
  products: 'products',
  sales: 'sales',
  purchases: 'purchase',
  suppliers: 'supplier',
  customers: 'customer',
  offices: 'office',
  staff: 'staff',
  roles: 'role',
  access: 'access_control',
  stock: 'stock',
  locations: 'location',
  racks: 'location',
  profile: 'profile',
  auth: 'auth',
};

/** Fields a response might carry that a human would recognise a record by. */
const LABEL_KEYS = [
  'invoice_no',
  'purchase_no',
  'transfer_no',
  'name',
  'office_name',
  'product_name',
  'full_name',
  'supplier_name',
  'role',
  'email',
  'sku',
];

/**
 * Writes an audit entry for every successful change. Reads are not logged —
 * a shop's trail is about what moved, and logging every grid refresh would
 * bury it. Nothing from the request body is stored.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<
      Request & { user?: JwtUser; body?: Record<string, unknown> }
    >();
    const action = this.actionFor(req);
    if (!action) return next.handle();

    return next.handle().pipe(
      tap((payload) => {
        const res = http.getResponse<Response>();
        const data = this.dataOf(payload);
        this.audit.record({
          office_id: this.officeOf(req, data),
          user_id: req.user?.sub ?? null,
          user_email: req.user?.email ?? '',
          module: this.moduleOf(req),
          action,
          entity_id: this.entityIdOf(req, data),
          entity_label: this.labelOf(data),
          method: req.method,
          path: req.originalUrl?.split('?')[0] ?? req.url,
          status_code: res.statusCode,
          ip: req.ip ?? '',
        });
      }),
    );
  }

  private actionFor(req: Request): AuditAction | null {
    switch (req.method) {
      case 'POST':
        // a login is worth a line of its own; a failed one never reaches here
        return req.originalUrl?.includes('/auth/login')
          ? AuditAction.LOGIN
          : AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return null; // GET and friends change nothing
    }
  }

  private moduleOf(req: Request): string {
    // strip the global /api prefix, then take the first segment
    const path = (req.originalUrl ?? req.url).split('?')[0];
    const parts = path.split('/').filter(Boolean);
    const first = parts[0] === 'api' ? parts[1] : parts[0];
    return MODULE_BY_SEGMENT[first ?? ''] ?? first ?? '';
  }

  private dataOf(payload: unknown): Record<string, any> | null {
    if (!payload || typeof payload !== 'object') return null;
    const body = payload as Record<string, any>;
    const data = body.data ?? body;
    return data && typeof data === 'object' ? data : null;
  }

  private entityIdOf(req: Request, data: Record<string, any> | null): string {
    const fromParam = (req.params as Record<string, string>)?.['id'];
    const fromBody = data?.id ?? data?.supplier?.id;
    return String(fromParam ?? fromBody ?? '');
  }

  private officeOf(
    req: Request & { body?: Record<string, unknown> },
    data: Record<string, any> | null,
  ): string | null {
    const candidate =
      data?.office_id ??
      req.body?.['office_id'] ??
      req.query?.['office_id'] ??
      null;
    return typeof candidate === 'string' && candidate ? candidate : null;
  }

  private labelOf(data: Record<string, any> | null): string {
    if (!data) return '';
    for (const key of LABEL_KEYS) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }
}
