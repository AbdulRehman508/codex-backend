import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { StorageService } from '../../common/storage/storage.service';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateOfficeDto } from './dto/create-office.dto';
import { QueryOfficeDto, SortOrder } from './dto/query-office.dto';
import { UpdateOfficeDto } from './dto/update-office.dto';
import { Office, OfficeDocument } from './schemas/office.schema';

// fields returned on the list endpoint (multi-select grid)
const LIST_FIELDS =
  'id office_name office_status office_mobile_no office_email';

@Injectable()
export class OfficeService {
  constructor(
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    private readonly fileStorage: StorageService,
  ) {}

  async create(dto: CreateOfficeDto): Promise<OfficeDocument> {
    await this.assertEmailUnique(dto.office_email);

    const payload: Partial<Office> = { ...dto };
    if (dto.office_logo) {
      payload.office_logo = this.fileStorage.saveBase64Image(dto.office_logo);
    }

    try {
      return await this.officeModel.create(payload);
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new ConflictException('office_email already exists');
      }
      throw e;
    }
  }

  async findAll(query: QueryOfficeDto): Promise<{
    data: Partial<Office>[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, sort, order } = query;

    const filter: Record<string, any> = { deleted_at: null };
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [
        { office_name: rx },
        { office_email: rx },
        { office_mobile_no: rx },
      ];
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.officeModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.officeModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((d) => d.toJSON()),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<OfficeDocument> {
    this.assertObjectId(id);
    const doc = await this.officeModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) {
      throw new NotFoundException(`Office ${id} not found`);
    }
    return doc;
  }

  // PUT — full update
  async update(id: string, dto: UpdateOfficeDto): Promise<OfficeDocument> {
    return this.applyUpdate(id, dto);
  }

  // PATCH — partial update
  async patch(id: string, dto: UpdateOfficeDto): Promise<OfficeDocument> {
    return this.applyUpdate(id, dto);
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    this.assertObjectId(id);
    const res = await this.officeModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    if (!res) {
      throw new NotFoundException(`Office ${id} not found`);
    }
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const res = await this.officeModel
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
    dto: UpdateOfficeDto,
  ): Promise<OfficeDocument> {
    const doc = await this.findOne(id);

    if (dto.office_email && dto.office_email !== doc.office_email) {
      await this.assertEmailUnique(dto.office_email, id);
    }

    const { office_logo, ...rest } = dto;
    Object.assign(doc, rest);

    // empty/null logo => keep existing; new base64 => replace
    if (office_logo && office_logo.trim()) {
      doc.office_logo = this.fileStorage.saveBase64Image(office_logo);
    }

    try {
      return await doc.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new ConflictException('office_email already exists');
      }
      throw e;
    }
  }

  private async assertEmailUnique(email: string, excludeId?: string) {
    const filter: Record<string, any> = {
      office_email: email.toLowerCase(),
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    const exists = await this.officeModel.exists(filter);
    if (exists) {
      throw new ConflictException('office_email already exists');
    }
  }

  private assertObjectId(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid office id "${id}"`);
    }
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
