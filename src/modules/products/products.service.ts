import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import {
  RackLocation,
  RackLocationDocument,
  RackLocationStatus,
} from '../locations/schemas/rack-location.schema';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductDto, SortOrder } from './dto/query-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product, ProductDocument } from './schemas/product.schema';

// columns loaded for the list grid
const LIST_FIELDS = 'name price quantity status';

/** Slim row for the list grid — no location join, only what the table shows. */
export interface ProductListRow {
  id: string;
  name: string;
  price: number;
  quantity: number;
  status: string;
}

/** Product joined with its physical location — returned by detail/create/update. */
export interface ProductRow {
  id: string;
  office_id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: number;
  quantity: number;
  description: string | null;
  status: string;
  rack_location_id: string | null;
  rack_id: string | null;
  rack_name: string | null;
  rack_code: string | null;
  row_no: number | null;
  column_no: number | null;
  bin_no: number | null;
  location_code: string | null;
  created_at: string | null;
  updated_at: string | null;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    // registered for FK existence checks
    @InjectModel(RackLocation.name)
    private readonly rackLocationModel: Model<RackLocationDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
  ) {}

  // ---------- create ----------

  async create(dto: CreateProductDto, userId?: string): Promise<ProductRow> {
    await this.assertOfficeExists(dto.office_id);
    await this.assertSkuUnique(dto.office_id, dto.sku);
    await this.assertBarcodeUnique(dto.office_id, dto.barcode);
    await this.assertLocationAssignable(dto.rack_location_id, dto.office_id);

    let created: ProductDocument;
    try {
      created = await this.productModel.create({
        ...dto,
        office_id: new Types.ObjectId(dto.office_id),
        rack_location_id: dto.rack_location_id
          ? new Types.ObjectId(dto.rack_location_id)
          : null,
        created_by: this.toObjectIdOrNull(userId),
        updated_by: this.toObjectIdOrNull(userId),
      });
    } catch (e) {
      this.rethrowDuplicate(e);
    }

    return this.findOne(created._id.toString());
  }

  // ---------- read ----------

  /**
   * List grid. Returns only the columns the table shows (name, price,
   * quantity, status) — no location join, so this is a plain indexed find.
   */
  async findAll(query: QueryProductDto): Promise<{
    data: ProductListRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, office_id, rack_id, status, sort, order } =
      query;

    const filter: Record<string, any> = { deleted_at: null };
    if (office_id) {
      filter.office_id = new Types.ObjectId(office_id);
    }
    if (status) {
      filter.status = status;
    }
    // "products in rack X" without a join: resolve the rack's bins first
    if (rack_id) {
      const binIds = (await this.rackLocationModel
        .distinct('_id', {
          rack_id: new Types.ObjectId(rack_id),
          deleted_at: null,
        })
        .exec()) as Types.ObjectId[];
      filter.rack_location_id = { $in: binIds };
    }
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.productModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.productModel.countDocuments(filter).exec(),
    ]);

    const data: ProductListRow[] = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      price: d.price,
      quantity: d.quantity,
      status: d.status,
    }));

    return { data, total, page, limit };
  }

  async findOne(id: string, officeId?: string): Promise<ProductRow> {
    this.assertObjectId(id);
    const match: Record<string, any> = {
      _id: new Types.ObjectId(id),
      deleted_at: null,
    };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      match.office_id = new Types.ObjectId(officeId);
    }

    const [doc] = await this.productModel
      .aggregate<Record<string, any>>([
        { $match: match },
        ...this.joinLocationStages(),
        { $limit: 1 },
      ])
      .exec();

    if (!doc) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return this.toRow(doc);
  }

  // ---------- update ----------

  async update(
    id: string,
    dto: UpdateProductDto,
    userId?: string,
  ): Promise<ProductRow> {
    return this.applyUpdate(id, dto, userId);
  }

  async patch(
    id: string,
    dto: UpdateProductDto,
    userId?: string,
  ): Promise<ProductRow> {
    return this.applyUpdate(id, dto, userId);
  }

  // ---------- delete ----------

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    this.assertObjectId(id);
    const res = await this.productModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    if (!res) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const res = await this.productModel
      .updateMany(
        { _id: { $in: dto.ids }, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    return { deleted_count: res.modifiedCount };
  }

  // ---------- helpers ----------

  private async applyUpdate(
    id: string,
    dto: UpdateProductDto,
    userId?: string,
  ): Promise<ProductRow> {
    this.assertObjectId(id);
    const doc = await this.productModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    const officeId = doc.office_id.toString();
    // the product's office is fixed — its location belongs to that office
    if (dto.office_id && dto.office_id !== officeId) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['a product cannot be moved to another office'] },
      });
    }

    if (dto.sku && dto.sku !== doc.sku) {
      await this.assertSkuUnique(officeId, dto.sku, id);
    }
    if (dto.barcode !== undefined && dto.barcode !== doc.barcode) {
      await this.assertBarcodeUnique(officeId, dto.barcode, id);
    }
    if (dto.rack_location_id !== undefined) {
      await this.assertLocationAssignable(dto.rack_location_id, officeId);
    }

    const { office_id: _ignored, rack_location_id, ...rest } = dto;
    Object.assign(doc, rest);
    if (rack_location_id !== undefined) {
      doc.rack_location_id = rack_location_id
        ? new Types.ObjectId(rack_location_id)
        : null;
    }
    doc.updated_by = this.toObjectIdOrNull(userId);

    try {
      await doc.save();
    } catch (e) {
      this.rethrowDuplicate(e);
    }

    return this.findOne(id);
  }

  /** $lookup rack_locations -> racks and flatten the location fields. */
  private joinLocationStages(): PipelineStage[] {
    return [
      {
        $lookup: {
          from: 'rack_locations',
          localField: 'rack_location_id',
          foreignField: '_id',
          as: 'location',
        },
      },
      { $unwind: { path: '$location', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'racks',
          localField: 'location.rack_id',
          foreignField: '_id',
          as: 'rack',
        },
      },
      { $unwind: { path: '$rack', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          rack_id: '$rack._id',
          rack_name: '$rack.name',
          rack_code: '$rack.code',
          row_no: '$location.row_no',
          column_no: '$location.column_no',
          bin_no: '$location.bin_no',
          location_code: '$location.location_code',
        },
      },
      { $project: { location: 0, rack: 0 } },
    ];
  }

  private toRow(d: Record<string, any>): ProductRow {
    const str = (v: unknown): string | null =>
      v === null || v === undefined ? null : String(v);
    return {
      id: String(d._id),
      office_id: String(d.office_id),
      name: d.name,
      sku: d.sku,
      barcode: d.barcode ?? null,
      price: d.price ?? 0,
      quantity: d.quantity ?? 0,
      description: d.description ?? null,
      status: d.status,
      rack_location_id: str(d.rack_location_id),
      rack_id: str(d.rack_id),
      rack_name: d.rack_name ?? null,
      rack_code: d.rack_code ?? null,
      row_no: d.row_no ?? null,
      column_no: d.column_no ?? null,
      bin_no: d.bin_no ?? null,
      location_code: d.location_code ?? null,
      created_at: d.created_at ? new Date(d.created_at).toISOString() : null,
      updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
    };
  }

  private async assertOfficeExists(officeId: string) {
    this.assertObjectId(officeId, 'office_id');
    const exists = await this.officeModel.exists({
      _id: officeId,
      deleted_at: null,
    });
    if (!exists) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['office does not exist'] },
      });
    }
  }

  /** The bin must exist, be active and belong to the product's office. */
  private async assertLocationAssignable(
    rackLocationId: string | null | undefined,
    officeId: string,
  ) {
    if (!rackLocationId) return; // unassigned is allowed
    this.assertObjectId(rackLocationId, 'rack_location_id');
    const bin = await this.rackLocationModel
      .findOne({ _id: rackLocationId, deleted_at: null })
      .exec();
    if (!bin) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { rack_location_id: ['location does not exist'] },
      });
    }
    if (bin.office_id.toString() !== officeId) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          rack_location_id: ['location belongs to a different office'],
        },
      });
    }
    if (bin.status !== RackLocationStatus.ACTIVE) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { rack_location_id: ['location is inactive'] },
      });
    }
  }

  private async assertSkuUnique(
    officeId: string,
    sku: string,
    excludeId?: string,
  ) {
    const filter: Record<string, any> = {
      office_id: new Types.ObjectId(officeId),
      sku: sku.toUpperCase(),
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.productModel.exists(filter)) {
      throw new ConflictException('sku already exists in this office');
    }
  }

  private async assertBarcodeUnique(
    officeId: string,
    barcode: string | null | undefined,
    excludeId?: string,
  ) {
    if (!barcode) return;
    const filter: Record<string, any> = {
      office_id: new Types.ObjectId(officeId),
      barcode,
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.productModel.exists(filter)) {
      throw new ConflictException('barcode already exists in this office');
    }
  }

  private assertObjectId(id: string, field = 'id') {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ${field} "${id}"`);
    }
  }

  private toObjectIdOrNull(id?: string): Types.ObjectId | null {
    return id && isValidObjectId(id) ? new Types.ObjectId(id) : null;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // duplicate-key (race with a unique index) -> 409 naming the field
  private rethrowDuplicate(e: unknown): never {
    if (isDuplicateKeyError(e)) {
      const key = Object.keys(e.keyPattern ?? {}).find((k) => k !== 'office_id');
      throw new ConflictException(
        key ? `${key} already exists in this office` : 'duplicate key',
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
