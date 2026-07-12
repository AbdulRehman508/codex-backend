import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { BulkDeleteRoleDto } from './dto/bulk-delete-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRoleDto, SortOrder } from './dto/query-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role, RoleDocument } from './schemas/role.schema';

// Default roles created for every new office.
const DEFAULT_ROLES: ReadonlyArray<string> = ['Admin'];

// Shape returned to clients (numeric id, office flattened to id + name).
export interface RoleView {
  id: number;
  role: string;
  description: string;
  office_id: string | null;
  office_name: string | null;
}

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
  async findForDropdown(officeIds?: string[]): Promise<Partial<Role>[]> {
    const filter = officeIds?.length ? { office_id: { $in: officeIds } } : {};
    const docs = await this.roleModel.find(filter).sort({ _id: 1 }).exec();
    return docs.map((d) => d.toJSON());
  }

  // Paginated management list (search, sort, optional office filter).
  async findAll(query: QueryRoleDto): Promise<{
    data: RoleView[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, sort, order, office_id } = query;

    const filter: Record<string, any> = {};
    if (office_id) filter.office_id = office_id;
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [{ role: rx }, { description: rx }];
    }

    const sortField = sort === 'role' ? 'role' : '_id';
    const sortSpec: Record<string, 1 | -1> = {
      [sortField]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.roleModel
        .find(filter)
        .populate('office_id', 'office_name')
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.roleModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((d) => this.toView(d)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: number): Promise<RoleView> {
    const doc = await this.roleModel
      .findById(id)
      .populate('office_id', 'office_name')
      .exec();
    if (!doc) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return this.toView(doc);
  }

  async create(dto: CreateRoleDto): Promise<RoleView> {
    const _id = await this.counters.next('role_id');
    try {
      await this.roleModel.create({
        _id,
        role: dto.role,
        description: dto.description,
        office_id: dto.office_id,
      });
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new ConflictException(
          'A role with this name already exists for this office',
        );
      }
      throw e;
    }
    return this.findOne(_id);
  }

  async update(id: number, dto: UpdateRoleDto): Promise<RoleView> {
    const doc = await this.roleModel.findById(id).exec();
    if (!doc) {
      throw new NotFoundException(`Role ${id} not found`);
    }

    if (dto.role !== undefined) doc.role = dto.role;
    if (dto.description !== undefined) doc.description = dto.description;
    if (dto.office_id !== undefined) {
      doc.office_id = new Types.ObjectId(dto.office_id);
    }

    try {
      await doc.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new ConflictException(
          'A role with this name already exists for this office',
        );
      }
      throw e;
    }
    return this.findOne(id);
  }

  async remove(id: number): Promise<{ id: number; deleted: boolean }> {
    const res = await this.roleModel.findByIdAndDelete(id).exec();
    if (!res) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteRoleDto): Promise<{ deleted_count: number }> {
    const res = await this.roleModel
      .deleteMany({ _id: { $in: dto.ids } })
      .exec();
    return { deleted_count: res.deletedCount };
  }

  // --- helpers ---

  private toView(doc: RoleDocument): RoleView {
    // office_id is populated to { _id, office_name } by the caller
    const office = doc.office_id as unknown as {
      _id?: Types.ObjectId;
      office_name?: string;
    } | null;
    const officeId = office?._id ?? (doc.office_id as unknown);
    return {
      id: doc._id,
      role: doc.role,
      description: doc.description ?? '',
      office_id: officeId ? String(officeId) : null,
      office_name: office?.office_name ?? null,
    };
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// MongoServerError duplicate-key code
function isDuplicateKeyError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: number }).code === 11000
  );
}
