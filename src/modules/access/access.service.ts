import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { RolesService } from '../roles/roles.service';
import { ACCESS_MODULES, AccessModule } from './access.constants';
import { UpdateAccessDto } from './dto/update-access.dto';
import { RoleAccess, RoleAccessDocument } from './schemas/role-access.schema';

// One row of the permission matrix returned to the client.
export interface AccessPermissionView {
  module: string;
  module_label: string;
  module_group: string | null;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

// Full matrix for a single role (office info flattened from the role).
export interface AccessView {
  role_id: number;
  role: string;
  office_id: string | null;
  office_name: string | null;
  permissions: AccessPermissionView[];
}

@Injectable()
export class AccessService {
  constructor(
    @InjectModel(RoleAccess.name)
    private readonly accessModel: Model<RoleAccessDocument>,
    private readonly rolesService: RolesService,
    private readonly counters: CountersService,
  ) {}

  // Static module catalog (dashboard, sales, ...) for the dropdown/columns.
  getModules(): ReadonlyArray<AccessModule> {
    return ACCESS_MODULES;
  }

  // READ — matrix for a role, merging stored permissions over the catalog so
  // every module always appears (defaults to no access). Throws 404 via
  // RolesService if the role doesn't exist.
  async getForRole(roleId: number): Promise<AccessView> {
    const role = await this.rolesService.findOne(roleId);
    const doc = await this.accessModel.findOne({ role_id: roleId }).exec();
    const stored = new Map(
      (doc?.permissions ?? []).map((p) => [p.module, p]),
    );

    const permissions: AccessPermissionView[] = ACCESS_MODULES.map((m) => {
      const p = stored.get(m.key);
      return {
        module: m.key,
        module_label: m.label,
        module_group: m.group ?? null,
        view: p?.view ?? false,
        create: p?.create ?? false,
        edit: p?.edit ?? false,
        delete: p?.delete ?? false,
      };
    });

    return {
      role_id: roleId,
      role: role.role,
      office_id: role.office_id,
      office_name: role.office_name,
      permissions,
    };
  }

  // UPDATE — upsert the whole matrix for a role. office_id is taken from the
  // role (not the client) so access can never drift from the role's office.
  // Unknown module keys are dropped to keep the store aligned to the catalog.
  async saveForRole(roleId: number, dto: UpdateAccessDto): Promise<AccessView> {
    const role = await this.rolesService.findOne(roleId);
    const officeId = new Types.ObjectId(role.office_id as string);

    const validKeys = new Set(ACCESS_MODULES.map((m) => m.key));
    const permissions = dto.permissions
      .filter((p) => validKeys.has(p.module))
      .map((p) => ({
        module: p.module,
        view: !!p.view,
        create: !!p.create,
        edit: !!p.edit,
        delete: !!p.delete,
      }));

    let doc = await this.accessModel.findOne({ role_id: roleId }).exec();
    if (!doc) {
      const _id = await this.counters.next('access_id');
      doc = new this.accessModel({
        _id,
        role_id: roleId,
        office_id: officeId,
        permissions,
      });
    } else {
      doc.office_id = officeId;
      doc.permissions = permissions;
    }
    await doc.save();

    return this.getForRole(roleId);
  }
}
