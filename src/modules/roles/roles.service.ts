import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { Role, RoleDocument } from './schemas/role.schema';

// Default roles created for every new office.
const DEFAULT_ROLES: ReadonlyArray<string> = ['Admin'];

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly counters: CountersService,
  ) {}

  // Seeds an office's default roles (numeric ids from the shared counter).
  async createDefaultsForOffice(
    officeId: Types.ObjectId | string,
  ): Promise<void> {
    for (const role of DEFAULT_ROLES) {
      const _id = await this.counters.next('role_id');
      await this.roleModel.create({ _id, role, office_id: officeId });
    }
  }

  // Roles for the given offices (dropdown source). No offices => all roles.
  async findAll(officeIds?: string[]): Promise<Partial<Role>[]> {
    const filter = officeIds?.length ? { office_id: { $in: officeIds } } : {};
    const docs = await this.roleModel.find(filter).sort({ _id: 1 }).exec();
    return docs.map((d) => d.toJSON());
  }
}
