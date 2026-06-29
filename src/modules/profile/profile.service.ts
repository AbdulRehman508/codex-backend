import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StorageService } from '../../common/storage/storage.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { Staff, StaffDocument } from '../staff/schemas/staff.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface ProfileResponse {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  mobile_no: string;
  cnic_no: string;
  office_ids: string[];
  offices: string[];
  role_id: number;
  role: string | null;
  address: string;
  biography: string | null;
  profile_photo: string | null;
  staff_status: string;
  created_at?: string;
  updated_at?: string;
}

@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(Staff.name)
    private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
    private readonly fileStorage: StorageService,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    const staff = await this.findLive(userId);
    return this.build(staff);
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const staff = await this.findLive(userId);

    if (dto.cnic_no && dto.cnic_no !== staff.cnic_no) {
      await this.assertCnicUnique(dto.cnic_no, userId);
    }

    const { profile_photo, ...rest } = dto;
    Object.assign(staff, rest);

    // empty/null photo => keep existing; new base64 => replace
    if (profile_photo && profile_photo.trim()) {
      staff.profile_photo = this.fileStorage.saveBase64Image(profile_photo, {
        folder: 'staff',
        field: 'profile_photo',
      });
    }

    try {
      await staff.save();
    } catch (e) {
      this.rethrowDuplicate(e);
    }

    return this.build(staff);
  }

  // --- helpers ---

  private async findLive(userId: string): Promise<StaffDocument> {
    const staff = await this.staffModel
      .findOne({ _id: userId, deleted_at: null })
      .exec();
    if (!staff) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return staff;
  }

  private async build(staff: StaffDocument): Promise<ProfileResponse> {
    const [offices, role] = await Promise.all([
      this.officeModel.find({ _id: { $in: staff.office_ids } }).exec(),
      this.roleModel.findById(staff.role_id).exec(),
    ]);
    const json = staff.toJSON() as { created_at?: string; updated_at?: string };
    return {
      id: staff._id.toString(),
      first_name: staff.first_name,
      last_name: staff.last_name,
      email: staff.email,
      mobile_no: staff.mobile_no,
      cnic_no: staff.cnic_no,
      office_ids: staff.office_ids.map((o) => o.toString()),
      offices: offices.map((o) => o.office_name),
      role_id: staff.role_id,
      role: role?.role ?? null,
      address: staff.address,
      biography: staff.biography ?? null,
      profile_photo: staff.profile_photo ?? null,
      staff_status: staff.staff_status,
      created_at: json.created_at,
      updated_at: json.updated_at,
    };
  }

  private async assertCnicUnique(cnic: string, excludeId: string) {
    if (
      await this.staffModel.exists({
        cnic_no: cnic,
        deleted_at: null,
        _id: { $ne: excludeId },
      })
    ) {
      throw new ConflictException('cnic_no already exists');
    }
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
