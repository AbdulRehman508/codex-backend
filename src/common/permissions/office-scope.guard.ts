import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import { Model } from 'mongoose';
import { JwtUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Role, RoleDocument } from '../../modules/roles/schemas/role.schema';
import { Staff, StaffDocument } from '../../modules/staff/schemas/staff.schema';

const ADMIN_ROLE = 'admin';

/**
 * `office_id` arrives from the client on nearly every call. Without this, a
 * user from one branch could simply pass another branch's id and read its
 * sales, customers and stock. Admins see every office; everyone else only the
 * offices they are assigned to.
 *
 * Checks `office_id` wherever it appears: query string, route param or body.
 */
@Injectable()
export class OfficeScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Staff.name)
    private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<
      Request & { user?: JwtUser; body?: Record<string, unknown> }
    >();
    const user = req.user;
    if (!user) return true; // the JWT guard already rejected this

    const requested = this.requestedOffices(req);
    if (!requested.length) return true; // nothing office-scoped on this call

    const role = await this.roleModel
      .findById(user.role_id)
      .select('role')
      .lean()
      .exec();
    if (role?.role?.trim().toLowerCase() === ADMIN_ROLE) return true;

    const staff = await this.staffModel
      .findOne({ _id: user.sub, deleted_at: null })
      .select('office_ids')
      .lean()
      .exec();
    const allowed = (staff?.office_ids ?? []).map((o) => o.toString());

    // every office named on the call must be one the user is assigned to —
    // a transfer names two, and both ends need the check
    if (requested.some((office) => !allowed.includes(office))) {
      throw new ForbiddenException('You are not assigned to that office');
    }
    return true;
  }

  /** `office_id`, plus the two ends of a transfer, wherever they appear. */
  private requestedOffices(
    req: Request & { body?: Record<string, unknown> },
  ): string[] {
    const keys = ['office_id', 'from_office_id', 'to_office_id'];
    const found = new Set<string>();
    for (const key of keys) {
      const value =
        req.query?.[key] ?? req.params?.[key] ?? req.body?.[key] ?? null;
      if (typeof value === 'string' && value.trim()) found.add(value.trim());
    }
    return [...found];
  }
}
