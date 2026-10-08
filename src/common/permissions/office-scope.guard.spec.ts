import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Role } from '../../modules/roles/schemas/role.schema';
import { Staff } from '../../modules/staff/schemas/staff.schema';
import { OfficeScopeGuard } from './office-scope.guard';

const OFFICE_A = '665f1c000000000000000001';
const OFFICE_B = '665f1c000000000000000002';

function contextFor(req: Record<string, unknown>) {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function chainedModel(value: unknown) {
  const exec = jest.fn().mockResolvedValue(value);
  const chain = { select: () => ({ lean: () => ({ exec }) }) };
  return {
    findById: jest.fn().mockReturnValue(chain),
    findOne: jest.fn().mockReturnValue(chain),
  };
}

describe('OfficeScopeGuard', () => {
  let guard: OfficeScopeGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  const build = async (role: unknown, staff: unknown) => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OfficeScopeGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getModelToken(Staff.name), useValue: chainedModel(staff) },
        { provide: getModelToken(Role.name), useValue: chainedModel(role) },
      ],
    }).compile();
    guard = moduleRef.get(OfficeScopeGuard);
  };

  const user = { sub: 'staff-1', role_id: 2 };

  it('ignores calls that name no office', async () => {
    await build({ role: 'Cashier' }, { office_ids: [] });

    await expect(
      guard.canActivate(contextFor({ user, query: {}, params: {} })),
    ).resolves.toBe(true);
  });

  it('allows an office the user is assigned to', async () => {
    await build({ role: 'Cashier' }, { office_ids: [OFFICE_A] });

    await expect(
      guard.canActivate(contextFor({ user, query: { office_id: OFFICE_A }, params: {} })),
    ).resolves.toBe(true);
  });

  it('blocks another office passed in the query string', async () => {
    await build({ role: 'Cashier' }, { office_ids: [OFFICE_A] });

    await expect(
      guard.canActivate(contextFor({ user, query: { office_id: OFFICE_B }, params: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks another office passed in the body', async () => {
    await build({ role: 'Cashier' }, { office_ids: [OFFICE_A] });

    await expect(
      guard.canActivate(
        contextFor({ user, query: {}, params: {}, body: { office_id: OFFICE_B } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an admin reach any office', async () => {
    await build({ role: 'Admin' }, { office_ids: [] });

    await expect(
      guard.canActivate(contextFor({ user, query: { office_id: OFFICE_B }, params: {} })),
    ).resolves.toBe(true);
  });

  it('allows a transfer between two offices the user holds', async () => {
    await build({ role: 'Cashier' }, { office_ids: [OFFICE_A, OFFICE_B] });

    await expect(
      guard.canActivate(
        contextFor({
          user,
          query: {},
          params: {},
          body: { office_id: OFFICE_A, to_office_id: OFFICE_B },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('blocks a transfer whose far end the user does not hold', async () => {
    await build({ role: 'Cashier' }, { office_ids: [OFFICE_A] });

    await expect(
      guard.canActivate(
        contextFor({
          user,
          query: {},
          params: {},
          body: { office_id: OFFICE_A, to_office_id: OFFICE_B },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a user with no offices at all', async () => {
    await build({ role: 'Cashier' }, { office_ids: [] });

    await expect(
      guard.canActivate(contextFor({ user, query: { office_id: OFFICE_A }, params: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
