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
import {
  RoleAccess,
  RoleAccessDocument,
} from '../../modules/access/schemas/role-access.schema';
import { Role, RoleDocument } from '../../modules/roles/schemas/role.schema';
import { EffectiveRoleService } from './effective-role.service';
import {
  ADMIN_ONLY_KEY,
  PERMISSION_KEY,
  RequiredPermission,
} from './permissions.decorator';

/**
 * Enforces the same access matrix the UI draws, on the server. Hiding a button
 * is not access control: without this, any signed-in user could call any
 * endpoint directly.
 *
 * Routes opt in with `@RequirePermission(module, action)` or `@AdminOnly()`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    @InjectModel(RoleAccess.name)
    private readonly accessModel: Model<RoleAccessDocument>,
    private readonly roles: EffectiveRoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const adminOnly = this.reflector.getAllAndOverride<boolean>(
      ADMIN_ONLY_KEY,
      targets,
    );
    const required = this.reflector.getAllAndOverride<RequiredPermission>(
      PERMISSION_KEY,
      targets,
    );
    if (!adminOnly && !required) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('Not allowed');
    }

    // which branch is this call about? that is whose rules apply
    const officeId =
      this.requestedOffice(req) ?? (await this.roles.lastOffice(user.sub));
    const effective = await this.roles.forOffice(user.role_id, officeId);

    if (effective.is_admin) return true;

    if (adminOnly) {
      throw new ForbiddenException('Admins only');
    }

    if (effective.role_id === null) {
      throw new ForbiddenException('Your role cannot be resolved');
    }

    const granted = await this.hasPermission(effective.role_id, required!);
    if (!granted) {
      throw new ForbiddenException(
        `Your role cannot ${required!.action} ${required!.module}`,
      );
    }
    return true;
  }

  /**
   * The branch the call is about. A transfer names two; the sending branch is
   * the one doing the thing being permitted, so it is the one checked.
   */
  private requestedOffice(
    req: Request & { body?: Record<string, unknown> },
  ): string | null {
    for (const key of ['office_id', 'from_office_id', 'to_office_id']) {
      const value =
        (req.query as Record<string, unknown>)?.[key] ??
        (req.params as Record<string, unknown>)?.[key] ??
        req.body?.[key] ??
        null;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  /** Fails closed: no stored matrix means no access. */
  private async hasPermission(
    roleId: number,
    required: RequiredPermission,
  ): Promise<boolean> {
    const access = await this.accessModel
      .findOne({ role_id: roleId })
      .select('permissions')
      .lean()
      .exec();
    const row = access?.permissions?.find((p) => p.module === required.module);
    return !!row?.[required.action];
  }
}
