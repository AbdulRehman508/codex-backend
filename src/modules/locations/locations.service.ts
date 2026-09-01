import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateRackDto, MAX_GENERATED_LOCATIONS } from './dto/create-rack.dto';
import { QueryRackDto, SortOrder } from './dto/query-rack.dto';
import { UpdateRackDto } from './dto/update-rack.dto';
import {
  RackLocation,
  RackLocationDocument,
  RackLocationStatus,
} from './schemas/rack-location.schema';
import { Rack, RackDocument } from './schemas/rack.schema';

// columns loaded for the list grid
const LIST_FIELDS =
  'name code description status rows_count columns_count bins_count created_at';

export interface RackListRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: string;
  rows_count: number;
  columns_count: number;
  bins_count: number;
  /** live bin documents generated for this rack */
  locations_count: number;
}

export interface BinOption {
  id: string;
  rack_id: string;
  row_no: number;
  column_no: number;
  bin_no: number;
  location_code: string;
  status: string;
  /** a product already sits here */
  occupied: boolean;
}

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Rack.name)
    private readonly rackModel: Model<RackDocument>,
    @InjectModel(RackLocation.name)
    private readonly rackLocationModel: Model<RackLocationDocument>,
    // registered for FK existence checks / "bin in use" guards
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  // ---------- create ----------

  async create(dto: CreateRackDto, userId?: string): Promise<RackDocument> {
    await this.assertOfficeExists(dto.office_id);
    this.assertGridSize(dto.rows_count, dto.columns_count, dto.bins_count);
    await this.assertCodeUnique(dto.office_id, dto.code);

    const rack = await this.rackModel.create({
      ...dto,
      office_id: new Types.ObjectId(dto.office_id),
      created_by: this.toObjectIdOrNull(userId),
      updated_by: this.toObjectIdOrNull(userId),
    });

    try {
      await this.rackLocationModel.insertMany(this.buildGrid(rack), {
        ordered: true,
      });
    } catch (e) {
      // roll the rack back so a failed generation leaves nothing behind
      await this.rackModel.deleteOne({ _id: rack._id }).exec();
      await this.rackLocationModel.deleteMany({ rack_id: rack._id }).exec();
      if (isDuplicateKeyError(e)) {
        throw new ConflictException(
          'location_code already exists — pick a different rack code',
        );
      }
      throw e;
    }

    return rack;
  }

  // ---------- read ----------

  async findAll(query: QueryRackDto): Promise<{
    data: RackListRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, office_id, status, sort, order } = query;

    const filter: Record<string, any> = { deleted_at: null };
    if (office_id) {
      filter.office_id = new Types.ObjectId(office_id);
    }
    if (status) {
      filter.status = status;
    }
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { description: rx }];
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.rackModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.rackModel.countDocuments(filter).exec(),
    ]);

    const counts = await this.countLocationsByRack(docs.map((d) => d._id));

    const data: RackListRow[] = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      code: d.code,
      description: d.description ?? null,
      status: d.status,
      rows_count: d.rows_count,
      columns_count: d.columns_count,
      bins_count: d.bins_count,
      locations_count: counts.get(d._id.toString()) ?? 0,
    }));

    return { data, total, page, limit };
  }

  /** Rack document only (used by update/delete and by other services). */
  async findOne(id: string, officeId?: string): Promise<RackDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.rackModel.findOne(filter).exec();
    if (!doc) {
      throw new NotFoundException(`Rack ${id} not found`);
    }
    return doc;
  }

  /** Rack plus every generated bin — powers the view screen. */
  async findOneDetail(id: string, officeId?: string) {
    const rack = await this.findOne(id, officeId);
    const locations = await this.listBinsOfRack(rack._id);
    return {
      ...rack.toJSON(),
      locations_count: locations.length,
      locations,
    };
  }

  // ---------- dependent dropdowns ----------

  async listRows(rackId: string, officeId?: string) {
    const rack = await this.findOne(rackId, officeId);
    const rows = (await this.rackLocationModel
      .distinct('row_no', { rack_id: rack._id, deleted_at: null })
      .exec()) as number[];
    return rows
      .sort((a, b) => a - b)
      .map((row_no) => ({ row_no, label: `Row ${row_no}` }));
  }

  async listColumns(rackId: string, rowNo: number, officeId?: string) {
    const rack = await this.findOne(rackId, officeId);
    this.assertPositiveInt(rowNo, 'row');
    const columns = (await this.rackLocationModel
      .distinct('column_no', {
        rack_id: rack._id,
        row_no: rowNo,
        deleted_at: null,
      })
      .exec()) as number[];
    return columns
      .sort((a, b) => a - b)
      .map((column_no) => ({ column_no, label: `Column ${column_no}` }));
  }

  async listBins(
    rackId: string,
    rowNo: number,
    columnNo: number,
    officeId?: string,
  ): Promise<BinOption[]> {
    const rack = await this.findOne(rackId, officeId);
    this.assertPositiveInt(rowNo, 'row');
    this.assertPositiveInt(columnNo, 'column');
    return this.listBinsOfRack(rack._id, { row_no: rowNo, column_no: columnNo });
  }

  // ---------- update ----------

  async update(
    id: string,
    dto: UpdateRackDto,
    userId?: string,
  ): Promise<RackDocument> {
    return this.applyUpdate(id, dto, userId);
  }

  async patch(
    id: string,
    dto: UpdateRackDto,
    userId?: string,
  ): Promise<RackDocument> {
    return this.applyUpdate(id, dto, userId);
  }

  // ---------- delete ----------

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const rack = await this.findOne(id);
    await this.assertRackNotInUse(rack);

    const now = new Date();
    await this.rackModel
      .updateOne({ _id: rack._id }, { deleted_at: now })
      .exec();
    await this.rackLocationModel
      .updateMany({ rack_id: rack._id, deleted_at: null }, { deleted_at: now })
      .exec();

    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const racks = await this.rackModel
      .find({ _id: { $in: dto.ids }, deleted_at: null })
      .exec();

    // validate them all first so a partial delete can't happen
    for (const rack of racks) {
      await this.assertRackNotInUse(rack);
    }

    const ids = racks.map((r) => r._id);
    const now = new Date();
    const res = await this.rackModel
      .updateMany({ _id: { $in: ids } }, { deleted_at: now })
      .exec();
    await this.rackLocationModel
      .updateMany(
        { rack_id: { $in: ids }, deleted_at: null },
        { deleted_at: now },
      )
      .exec();

    return { deleted_count: res.modifiedCount };
  }

  // ---------- helpers ----------

  private async applyUpdate(
    id: string,
    dto: UpdateRackDto,
    userId?: string,
  ): Promise<RackDocument> {
    const rack = await this.findOne(id);

    // a rack cannot move between offices — its bins (and the products that
    // point at them) are office-scoped too
    if (dto.office_id && dto.office_id !== rack.office_id.toString()) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['a rack cannot be moved to another office'] },
      });
    }

    const nextRows = dto.rows_count ?? rack.rows_count;
    const nextColumns = dto.columns_count ?? rack.columns_count;
    const nextBins = dto.bins_count ?? rack.bins_count;
    this.assertGridSize(nextRows, nextColumns, nextBins);

    const codeChanged = !!dto.code && dto.code !== rack.code;
    if (codeChanged) {
      await this.assertCodeUnique(
        rack.office_id.toString(),
        dto.code!,
        rack._id.toString(),
      );
    }

    const prevRows = rack.rows_count;
    const prevColumns = rack.columns_count;
    const prevBins = rack.bins_count;
    const shrinks =
      nextRows < prevRows || nextColumns < prevColumns || nextBins < prevBins;
    const grows =
      nextRows > prevRows || nextColumns > prevColumns || nextBins > prevBins;

    // 1. drop slots that fall outside the new grid — blocked when a product
    //    still lives in one of them
    if (shrinks) {
      const outsideFilter = {
        rack_id: rack._id,
        deleted_at: null,
        $or: [
          { row_no: { $gt: nextRows } },
          { column_no: { $gt: nextColumns } },
          { bin_no: { $gt: nextBins } },
        ],
      };
      const outside = await this.rackLocationModel
        .find(outsideFilter)
        .select('_id location_code')
        .exec();
      if (outside.length) {
        await this.assertBinsFree(
          outside.map((b) => ({
            id: b._id,
            location_code: b.location_code,
          })),
          'the rack cannot be shrunk',
        );
        await this.rackLocationModel
          .updateMany(outsideFilter, { deleted_at: new Date() })
          .exec();
      }
    }

    const { office_id: _ignored, ...rest } = dto;
    Object.assign(rack, rest);
    rack.rows_count = nextRows;
    rack.columns_count = nextColumns;
    rack.bins_count = nextBins;
    rack.updated_by = this.toObjectIdOrNull(userId);

    try {
      await rack.save();
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        throw new ConflictException('code already exists in this office');
      }
      throw e;
    }

    // 2. rename every bin when the rack code changed (codes derive from it)
    if (codeChanged) {
      try {
        await this.rackLocationModel
          .updateMany({ rack_id: rack._id, deleted_at: null }, [
            {
              $set: {
                location_code: {
                  $concat: [
                    rack.code,
                    '-R',
                    { $toString: '$row_no' },
                    '-C',
                    { $toString: '$column_no' },
                    '-B',
                    { $toString: '$bin_no' },
                  ],
                },
              },
            },
          ])
          .exec();
      } catch (e) {
        if (isDuplicateKeyError(e)) {
          throw new ConflictException(
            'location_code already exists — pick a different rack code',
          );
        }
        throw e;
      }
    }

    // 3. add the slots the new grid introduced
    if (grows) {
      const existing = await this.rackLocationModel
        .find({ rack_id: rack._id, deleted_at: null })
        .select('row_no column_no bin_no')
        .exec();
      const seen = new Set(
        existing.map((b) => `${b.row_no}:${b.column_no}:${b.bin_no}`),
      );
      const missing = this.buildGrid(rack).filter(
        (b) => !seen.has(`${b.row_no}:${b.column_no}:${b.bin_no}`),
      );
      if (missing.length) {
        try {
          await this.rackLocationModel.insertMany(missing, { ordered: true });
        } catch (e) {
          if (isDuplicateKeyError(e)) {
            throw new ConflictException(
              'location_code already exists — pick a different rack code',
            );
          }
          throw e;
        }
      }
    }

    return rack;
  }

  /** Every non-deleted bin of a rack, ordered row -> column -> bin. */
  private async listBinsOfRack(
    rackId: Types.ObjectId,
    extra: Record<string, any> = {},
  ): Promise<BinOption[]> {
    const bins = await this.rackLocationModel
      .find({ rack_id: rackId, deleted_at: null, ...extra })
      .sort({ row_no: 1, column_no: 1, bin_no: 1 })
      .exec();

    const occupiedIds = await this.occupiedBinIds(bins.map((b) => b._id));

    return bins.map((b) => ({
      id: b._id.toString(),
      rack_id: b.rack_id.toString(),
      row_no: b.row_no,
      column_no: b.column_no,
      bin_no: b.bin_no,
      location_code: b.location_code,
      status: b.status,
      occupied: occupiedIds.has(b._id.toString()),
    }));
  }

  /** Subset of the given bin ids that a live product points at. */
  private async occupiedBinIds(
    binIds: Types.ObjectId[],
  ): Promise<Set<string>> {
    if (!binIds.length) return new Set();
    const rows = (await this.productModel
      .distinct('rack_location_id', {
        rack_location_id: { $in: binIds },
        deleted_at: null,
      })
      .exec()) as Types.ObjectId[];
    return new Set(rows.filter(Boolean).map((id) => id.toString()));
  }

  private async countLocationsByRack(
    rackIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (!rackIds.length) return new Map();
    const rows = await this.rackLocationModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { rack_id: { $in: rackIds }, deleted_at: null } },
        { $group: { _id: '$rack_id', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [r._id.toString(), r.count]));
  }

  /** Cartesian product of rows x columns x bins as insertable documents. */
  private buildGrid(rack: RackDocument): Array<Partial<RackLocation>> {
    const docs: Array<Partial<RackLocation>> = [];
    for (let r = 1; r <= rack.rows_count; r++) {
      for (let c = 1; c <= rack.columns_count; c++) {
        for (let b = 1; b <= rack.bins_count; b++) {
          docs.push({
            rack_id: rack._id,
            office_id: rack.office_id,
            row_no: r,
            column_no: c,
            bin_no: b,
            location_code: buildLocationCode(rack.code, r, c, b),
            status: RackLocationStatus.ACTIVE,
          });
        }
      }
    }
    return docs;
  }

  private async assertRackNotInUse(rack: RackDocument) {
    const bins = await this.rackLocationModel
      .find({ rack_id: rack._id, deleted_at: null })
      .select('_id location_code')
      .exec();
    await this.assertBinsFree(
      bins.map((b) => ({ id: b._id, location_code: b.location_code })),
      `rack "${rack.code}" cannot be deleted`,
    );
  }

  private async assertBinsFree(
    bins: Array<{ id: Types.ObjectId; location_code: string }>,
    reason: string,
  ) {
    if (!bins.length) return;
    const occupied = await this.occupiedBinIds(bins.map((b) => b.id));
    if (!occupied.size) return;
    const codes = bins
      .filter((b) => occupied.has(b.id.toString()))
      .map((b) => b.location_code);
    throw new ConflictException(
      `${reason}: ${codes.length} location(s) still hold products (${codes
        .slice(0, 5)
        .join(', ')}${codes.length > 5 ? ', ...' : ''})`,
    );
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

  private async assertCodeUnique(
    officeId: string,
    code: string,
    excludeId?: string,
  ) {
    const filter: Record<string, any> = {
      office_id: new Types.ObjectId(officeId),
      code: code.toUpperCase(),
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.rackModel.exists(filter)) {
      throw new ConflictException('code already exists in this office');
    }
  }

  private assertGridSize(rows: number, columns: number, bins: number) {
    const total = rows * columns * bins;
    if (total > MAX_GENERATED_LOCATIONS) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          rows_count: [
            `rows x columns x bins = ${total}, max ${MAX_GENERATED_LOCATIONS} locations per rack`,
          ],
        },
      });
    }
  }

  private assertPositiveInt(value: number, field: string) {
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException(`Invalid ${field} "${value}"`);
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
}

/** RACK-A + (1,2,3) -> RACK-A-R1-C2-B3 */
export function buildLocationCode(
  rackCode: string,
  row: number,
  column: number,
  bin: number,
): string {
  return `${rackCode.toUpperCase()}-R${row}-C${column}-B${bin}`;
}

function isDuplicateKeyError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: number }).code === 11000
  );
}
