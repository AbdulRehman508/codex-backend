import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { isValidObjectId, Model } from 'mongoose';
import { StorageService } from '../../common/storage/storage.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { QueryStaffDto, SortOrder } from './dto/query-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { Staff, StaffDocument } from './schemas/staff.schema';

const BCRYPT_ROUNDS = 10;

// columns loaded for the list grid (full_name built from first/last)
const LIST_FIELDS = 'first_name last_name staff_status mobile_no email';

export interface StaffListRow {
  id: string;
  full_name: string;
  staff_status: string;
  mobile_no: string;
  email: string;
}

@Injectable()
export class StaffService {
  constructor(
    @InjectModel(Staff.name)
    private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly fileStorage: StorageService,
  ) {}

  async create(dto: CreateStaffDto): Promise<StaffDocument> {
    await this.assertEmailUnique(dto.email);
    await this.assertCnicUnique(dto.cnic_no);
    await this.assertOfficesExist(dto.office_ids);
    await this.assertRoleExists(dto.role_id, dto.office_ids);

    const { profile_photo, password, ...rest } = dto;
    // office_ids arrive as strings; Mongoose casts each to ObjectId on write
    const payload: Record<string, any> = { ...rest };
    payload.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    if (profile_photo && profile_photo.trim()) {
      payload.profile_photo = this.fileStorage.saveBase64Image(profile_photo, {
        folder: 'staff',
        field: 'profile_photo',
      });
    }

    try {
      const created = await this.staffModel.create(payload);
      return created;
    } catch (e) {
      this.rethrowDuplicate(e);
    }
  }

  async findAll(query: QueryStaffDto): Promise<{
    data: StaffListRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, role_id, office_id, sort, order } = query;

    const filter: Record<string, any> = { deleted_at: null };
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [
        { first_name: rx },
        { last_name: rx },
        { email: rx },
        { mobile_no: rx },
      ];
    }
    if (role_id !== undefined) {
      filter.role_id = role_id;
    }
    // staff belong to many offices; match those linked to this office
    if (office_id) {
      filter.office_ids = office_id;
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.staffModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.staffModel.countDocuments(filter).exec(),
    ]);

    const data: StaffListRow[] = docs.map((d) => ({
      id: d._id.toString(),
      full_name: `${d.first_name} ${d.last_name}`,
      staff_status: d.staff_status,
      mobile_no: d.mobile_no,
      email: d.email,
    }));

    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<StaffDocument> {
    this.assertObjectId(id);
    const doc = await this.staffModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) {
      throw new NotFoundException(`Staff ${id} not found`);
    }
    return doc;
  }

  // PUT — full update
  async update(id: string, dto: UpdateStaffDto): Promise<StaffDocument> {
    return this.applyUpdate(id, dto);
  }

  // PATCH — partial update (main use: toggle staff_status)
  async patch(id: string, dto: UpdateStaffDto): Promise<StaffDocument> {
    return this.applyUpdate(id, dto);
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    this.assertObjectId(id);
    const res = await this.staffModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    if (!res) {
      throw new NotFoundException(`Staff ${id} not found`);
    }
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const res = await this.staffModel
      .updateMany(
        { _id: { $in: dto.ids }, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    return { deleted_count: res.modifiedCount };
  }

  // --- helpers ---

  private async applyUpdate(
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffDocument> {
    const doc = await this.findOne(id);

    if (dto.email && dto.email.toLowerCase() !== doc.email) {
      await this.assertEmailUnique(dto.email, id);
    }
    if (dto.cnic_no && dto.cnic_no !== doc.cnic_no) {
      await this.assertCnicUnique(dto.cnic_no, id);
    }
    const officeChanged = !!dto.office_ids;
    if (officeChanged) {
      await this.assertOfficesExist(dto.office_ids!);
    }
    // re-check role when role OR offices change — role must belong to an office
    const roleChanged = dto.role_id !== undefined && dto.role_id !== doc.role_id;
    if (roleChanged || officeChanged) {
      const roleId = dto.role_id ?? doc.role_id;
      const officeIds =
        dto.office_ids ?? doc.office_ids.map((o) => o.toString());
      await this.assertRoleExists(roleId, officeIds);
    }

    const { profile_photo, password, ...rest } = dto;
    Object.assign(doc, rest);

    // empty/null password => keep existing; otherwise re-hash
    if (password && password.trim()) {
      doc.password = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }

    // empty/null photo => keep existing; new base64 => replace
    if (profile_photo && profile_photo.trim()) {
      doc.profile_photo = this.fileStorage.saveBase64Image(profile_photo, {
        folder: 'staff',
        field: 'profile_photo',
      });
    }

    try {
      return await doc.save();
    } catch (e) {
      this.rethrowDuplicate(e);
    }
  }

  private async assertEmailUnique(email: string, excludeId?: string) {
    const filter: Record<string, any> = {
      email: email.toLowerCase(),
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.staffModel.exists(filter)) {
      throw new ConflictException('email already exists');
    }
  }

  private async assertCnicUnique(cnic: string, excludeId?: string) {
    const filter: Record<string, any> = { cnic_no: cnic, deleted_at: null };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.staffModel.exists(filter)) {
      throw new ConflictException('cnic_no already exists');
    }
  }

  private async assertOfficesExist(officeIds: string[]) {
    const ids = [...new Set(officeIds)];
    ids.forEach((id) => this.assertObjectId(id, 'office_ids'));
    const count = await this.officeModel.countDocuments({
      _id: { $in: ids },
      deleted_at: null,
    });
    if (count !== ids.length) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_ids: ['one or more offices do not exist'] },
      });
    }
  }

  // role must belong to one of the staff's offices
  private async assertRoleExists(roleId: number, officeIds: string[]) {
    const exists = await this.roleModel.exists({
      _id: roleId,
      office_id: { $in: officeIds },
    });
    if (!exists) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { role_id: ['role does not belong to any of the offices'] },
      });
    }
  }

  private assertObjectId(id: string, field = 'id') {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ${field} "${id}"`);
    }
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // duplicate-key (race with the unique index) -> 409 with the right field
  private rethrowDuplicate(e: unknown): never {
    if (isDuplicateKeyError(e)) {
      const key = Object.keys(e.keyPattern ?? {})[0];
      throw new ConflictException(
        key ? `${key} already exists` : 'duplicate key',
      );
    }
    throw e;
  }
}

interface DuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(e: unknown): e is DuplicateKeyError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: number }).code === 11000
  );
}
