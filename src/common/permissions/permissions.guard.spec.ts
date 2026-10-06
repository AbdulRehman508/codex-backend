import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RoleAccess } from '../../modules/access/schemas/role-access.schema';
import { Role } from '../../modules/roles/schemas/role.schema';
import { ADMIN_ONLY_KEY, PERMISSION_KEY } from './permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

/** Minimal ExecutionContext: only what the guard actually reads. */
function contextFor(user: unknown) {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

/** `model.findById(..).select(..).lean().exec()` -> value */
function chainedModel(value: unknown) {
  const exec = jest.fn().mockResolvedValue(value);
  return {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec }) }),
    }),
    findOne: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec }) }),
    }),
  };
}

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let roleModel: ReturnType<typeof chainedModel>;
  let accessModel: ReturnType<typeof chainedModel>;

  const build = async (role: unknown, access: unknown) => {
    reflector = { getAllAndOverride: jest.fn() };
    roleModel = chainedModel(role);
    accessModel = chainedModel(access);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getModelToken(Role.name), useValue: roleModel },
        { provide: getModelToken(RoleAccess.name), useValue: accessModel },
      ],
    }).compile();

    guard = moduleRef.get(PermissionsGuard);
  };

  /** metadata lookups the guard makes, in order: public, adminOnly, required */
  const metadata = (opts: {
    isPublic?: boolean;
    adminOnly?: boolean;
    required?: { module: string; action: string };
  }) => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === ADMIN_ONLY_KEY) return opts.adminOnly;
      if (key === PERMISSION_KEY) return opts.required;
      return opts.isPublic;
    });
  };

  it('lets public routes through without touching the database', async () => {
    await build(null, null);
    metadata({ isPublic: true });

    await expect(guard.canActivate(contextFor(undefined))).resolves.toBe(true);
    expect(roleModel.findById).not.toHaveBeenCalled();
  });

  it('lets undecorated routes through', async () => {
    await build(null, null);
    metadata({});

    await expect(guard.canActivate(contextFor({ role_id: 2 }))).resolves.toBe(true);
  });

  it('rejects a request with no authenticated user', async () => {
    await build(null, null);
    metadata({ required: { module: 'sales', action: 'view' } });

    await expect(guard.canActivate(contextFor(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets an admin past any requirement', async () => {
    await build({ role: 'Admin' }, null);
    metadata({ adminOnly: true, required: { module: 'sales', action: 'delete' } });

    await expect(guard.canActivate(contextFor({ role_id: 1 }))).resolves.toBe(true);
    expect(accessModel.findOne).not.toHaveBeenCalled();
  });

  it('blocks a non-admin from an admin-only route', async () => {
    await build({ role: 'Cashier' }, null);
    metadata({ adminOnly: true });

    await expect(guard.canActivate(contextFor({ role_id: 2 }))).rejects.toThrow(
      'Admins only',
    );
  });

  it('allows the exact action the matrix grants', async () => {
    await build(
      { role: 'Cashier' },
      { permissions: [{ module: 'sales', view: true, create: false, edit: false, delete: false }] },
    );
    metadata({ required: { module: 'sales', action: 'view' } });

    await expect(guard.canActivate(contextFor({ role_id: 2 }))).resolves.toBe(true);
  });

  it('blocks an action the matrix does not grant', async () => {
    await build(
      { role: 'Cashier' },
      { permissions: [{ module: 'sales', view: true, create: false, edit: false, delete: false }] },
    );
    metadata({ required: { module: 'sales', action: 'create' } });

    await expect(guard.canActivate(contextFor({ role_id: 2 }))).rejects.toThrow(
      'cannot create sales',
    );
  });

  it('fails closed when the role has no stored matrix', async () => {
    await build({ role: 'Cashier' }, null);
    metadata({ required: { module: 'products', action: 'view' } });

    await expect(
      guard.canActivate(contextFor({ role_id: 2 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not leak one module’s grant into another', async () => {
    await build(
      { role: 'Cashier' },
      { permissions: [{ module: 'products', view: true, create: true, edit: true, delete: true }] },
    );
    metadata({ required: { module: 'sales', action: 'view' } });

    await expect(guard.canActivate(contextFor({ role_id: 2 }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
