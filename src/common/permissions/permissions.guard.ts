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
import {
  ADMIN_ONLY_KEY,
  PERMISSION_KEY,
  RequiredPermission,
} from './permissions.decorator';

const ADMIN_ROLE = 'admin';

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

    const isAdmin = await this.isAdmin(user.role_id);
    if (isAdmin) return true;

    if (adminOnly) {
      throw new ForbiddenException('Admins only');
    }

    const granted = await this.hasPermission(user.role_id, required!);
    if (!granted) {
      throw new ForbiddenException(
        `Your role cannot ${required!.action} ${required!.module}`,
      );
    }
    return true;
  }

  private async isAdmin(roleId: number): Promise<boolean> {
    if (roleId === undefined || roleId === null) return false;
    const role = await this.roleModel
      .findById(roleId)
      .select('role')
      .lean()
      .exec();
    return role?.role?.trim().toLowerCase() === ADMIN_ROLE;
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
