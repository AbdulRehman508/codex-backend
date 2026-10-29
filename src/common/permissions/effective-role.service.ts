import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';

import { Role, RoleDocument } from '../../modules/roles/schemas/role.schema';
import { Staff, StaffDocument } from '../../modules/staff/schemas/staff.schema';

export const ADMIN_ROLE = 'admin';

/** The role a user actually works under in one branch. */
export interface EffectiveRole {
  role_id: number | null;
  role: string | null;
  office_id: string | null;
  is_admin: boolean;
}

/**
 * Which role applies, in which branch.
 *
 * A role belongs to one office, and every office is seeded with the same set
 * of role names. A staff member can work in several offices, so the role
 * stored on their record is the one from whichever office they were created
 * in — on its own that makes the permission matrix of *that* branch follow
 * them everywhere, which is not what a branch manager means by "manager here".
 *
 * So the role is resolved per branch: the same role **name** in the office
 * being used. Each branch can then grant its own manager a different matrix,
 * and a user moving between branches picks up each branch's rules without
 * anybody re-assigning anything.
 *
 * An admin is an admin everywhere — the one role that is not branch-local.
 */
@Injectable()
export class EffectiveRoleService {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    @InjectModel(Staff.name)
    private readonly staffModel: Model<StaffDocument>,
  ) {}

  /**
   * Resolve the role for `officeId`. With no office, or no matching role in
   * that office, the user's own role stands — the caller decides whether that
   * is enough, and the permission check itself still fails closed.
   */
  async forOffice(
    baseRoleId: number,
    officeId?: string | null,
  ): Promise<EffectiveRole> {
    const base = await this.roleModel
      .findById(baseRoleId)
      .select('role office_id')
      .lean()
      .exec();

    const baseName = base?.role?.trim() ?? null;
    const isAdmin = baseName?.toLowerCase() === ADMIN_ROLE;

    const asBase: EffectiveRole = {
      role_id: base ? baseRoleId : null,
      role: baseName,
      office_id: base?.office_id ? String(base.office_id) : null,
      is_admin: !!isAdmin,
    };

    // an admin carries the same authority into every branch
    if (!base || isAdmin) return asBase;
    if (!officeId || !isValidObjectId(officeId)) return asBase;
    // already the office this role belongs to
    if (String(base.office_id) === String(officeId)) return asBase;

    const local = await this.roleModel
      .findOne({
        office_id: new Types.ObjectId(officeId),
        // the names are seeded per office, so match on the name, not the id
        role: new RegExp(`^${escapeRegExp(baseName ?? '')}$`, 'i'),
      })
      .select('_id role office_id')
      .lean()
      .exec();

    if (!local) return asBase;

    return {
      role_id: local._id as unknown as number,
      role: local.role ?? baseName,
      office_id: String(local.office_id),
      is_admin: false,
    };
  }

  /** The branch a user last worked in — what a call with no office falls back to. */
  async lastOffice(userId: string): Promise<string | null> {
    if (!isValidObjectId(userId)) return null;
    const staff = await this.staffModel
      .findOne({ _id: userId, deleted_at: null })
      .select('last_office_id office_ids')
      .lean()
      .exec();
    const last = staff?.last_office_id ?? staff?.office_ids?.[0] ?? null;
    return last ? String(last) : null;
  }
}

/** A role name is free text; it must not be read as a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
