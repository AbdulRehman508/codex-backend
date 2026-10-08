import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { QueryTransferDto, SortOrder } from './dto/query-transfer.dto';
import {
  StockTransfer,
  StockTransferDocument,
  TransferLine,
} from './schemas/stock-transfer.schema';

export interface TransferRow {
  id: string;
  transfer_no: string;
  from_office_id: string;
  to_office_id: string;
  from_office_name: string;
  to_office_name: string;
  items_count: number;
  units: number;
  note: string;
  reversed: boolean;
  created_at: string | null;
}

export interface TransferSummary {
  transfers: number;
  units: number;
}

/** one leg of the move, so a failure can be undone exactly */
interface AppliedMove {
  productId: Types.ObjectId;
  delta: number;
}

@Injectable()
export class TransfersService {
  constructor(
    @InjectModel(StockTransfer.name)
    private readonly transferModel: Model<StockTransferDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    private readonly counters: CountersService,
  ) {}

  // ---------- create ----------

  /**
   * Move stock from one branch to another. Products are office-scoped, so the
   * receiving branch gets its own product record for the SKU — created from
   * the sending one the first time that branch sees it.
   */
  async create(
    dto: CreateTransferDto,
    userId?: string,
  ): Promise<StockTransferDocument> {
    const from = await this.office(dto.office_id, 'office_id');
    const to = await this.office(dto.to_office_id, 'to_office_id');
    if (from._id.equals(to._id)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { to_office_id: ['pick a different office to send stock to'] },
      });
    }

    const seen = new Set<string>();
    for (const line of dto.lines) {
      if (seen.has(line.product_id)) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: { lines: ['the same product is listed twice'] },
        });
      }
      seen.add(line.product_id);
    }

    const applied: AppliedMove[] = [];
    const lines: TransferLine[] = [];
    let units = 0;

    try {
      for (const line of dto.lines) {
        const source = await this.productModel
          .findOne({
            _id: line.product_id,
            office_id: from._id,
            deleted_at: null,
          })
          .exec();
        if (!source) {
          throw new BadRequestException({
            message: 'Validation failed',
            errors: {
              lines: [`a product on this transfer is not in ${from.office_name}`],
            },
          });
        }

        const target = await this.twinProduct(source, to._id);

        // take first, and only if the units are really there
        const taken = await this.productModel
          .findOneAndUpdate(
            {
              _id: source._id,
              deleted_at: null,
              quantity: { $gte: line.quantity },
            },
            { $inc: { quantity: -line.quantity } },
            { new: true },
          )
          .exec();
        if (!taken) {
          throw new BadRequestException({
            message: 'Validation failed',
            errors: {
              lines: [
                `"${source.name}" has only ${source.quantity} in ${from.office_name}`,
              ],
            },
          });
        }
        applied.push({ productId: source._id, delta: -line.quantity });

        await this.productModel
          .updateOne({ _id: target._id }, { $inc: { quantity: line.quantity } })
          .exec();
        applied.push({ productId: target._id, delta: line.quantity });

        lines.push({
          product_id: source._id,
          to_product_id: target._id,
          name: source.name,
          sku: source.sku ?? '',
          quantity: line.quantity,
        });
        units += line.quantity;
      }

      return await this.transferModel.create({
        transfer_no: await this.nextTransferNo(from._id.toString()),
        from_office_id: from._id,
        to_office_id: to._id,
        from_office_name: from.office_name,
        to_office_name: to.office_name,
        lines,
        items_count: lines.length,
        units,
        note: dto.note?.trim() ?? '',
        created_by: this.toObjectIdOrNull(userId),
      });
    } catch (e) {
      await this.undo(applied);
      throw e;
    }
  }

  // ---------- read ----------

  async findAll(query: QueryTransferDto): Promise<{
    data: TransferRow[];
    total: number;
    page: number;
    limit: number;
    summary: TransferSummary;
  }> {
    const { page, limit, sort, order } = query;
    const filter = this.buildFilter(query);
    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total, totals] = await Promise.all([
      this.transferModel
        .find(filter)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.transferModel.countDocuments(filter).exec(),
      this.transferModel
        .aggregate<{ units: number }>([
          { $match: filter },
          { $group: { _id: null, units: { $sum: '$units' } } },
        ])
        .exec(),
    ]);

    return {
      data: docs.map((d) => this.toRow(d)),
      total,
      page,
      limit,
      summary: { transfers: total, units: totals[0]?.units ?? 0 },
    };
  }

  async findOne(id: string, officeId?: string): Promise<StockTransferDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      const office = new Types.ObjectId(officeId);
      // either end of the move may open it
      filter.$or = [{ from_office_id: office }, { to_office_id: office }];
    }
    const doc = await this.transferModel.findOne(filter).exec();
    if (!doc) throw new NotFoundException(`Transfer ${id} not found`);
    return doc;
  }

  // ---------- reverse ----------

  /**
   * Undo a transfer: the units go back where they came from. Refused when the
   * receiving branch has already sold them on, since that stock is gone.
   */
  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const transfer = await this.findOne(id);
    const applied: AppliedMove[] = [];

    try {
      for (const line of transfer.lines) {
        const back = await this.productModel
          .findOneAndUpdate(
            {
              _id: line.to_product_id,
              deleted_at: null,
              quantity: { $gte: line.quantity },
            },
            { $inc: { quantity: -line.quantity } },
            { new: true },
          )
          .exec();
        if (!back) {
          throw new BadRequestException(
            `"${line.name}" has already been sold on in ${transfer.to_office_name} — the transfer cannot be reversed`,
          );
        }
        applied.push({ productId: line.to_product_id, delta: -line.quantity });

        await this.productModel
          .updateOne(
            { _id: line.product_id },
            { $inc: { quantity: line.quantity } },
          )
          .exec();
        applied.push({ productId: line.product_id, delta: line.quantity });
      }
    } catch (e) {
      await this.undo(applied);
      throw e;
    }

    transfer.deleted_at = new Date();
    await transfer.save();
    return { id, deleted: true };
  }

  // ---------- helpers ----------

  /**
   * The receiving office's own record for this SKU, created on first sight so
   * a branch never needs the product set up by hand before stock arrives.
   */
  private async twinProduct(
    source: ProductDocument,
    officeId: Types.ObjectId,
  ): Promise<ProductDocument> {
    const existing = await this.productModel
      .findOne({ office_id: officeId, sku: source.sku, deleted_at: null })
      .exec();
    if (existing) return existing;

    return this.productModel.create({
      office_id: officeId,
      name: source.name,
      sku: source.sku,
      // barcode is unique per office, so the twin may carry the same one
      barcode: source.barcode ?? null,
      price: source.price,
      quantity: 0,
      cost_price: source.cost_price ?? 0,
      min_stock: source.min_stock ?? 0,
      unit: source.unit,
      pack_size: source.pack_size ?? 1,
      description: source.description,
      status: source.status,
      // the bin belongs to the sending branch's racks, never the receiver's
      rack_location_id: null,
    });
  }

  /** Put back every leg that did go through before the failure. */
  private async undo(applied: AppliedMove[]): Promise<void> {
    for (const move of applied.reverse()) {
      await this.productModel
        .updateOne({ _id: move.productId }, { $inc: { quantity: -move.delta } })
        .exec();
    }
  }

  private buildFilter(query: QueryTransferDto): Record<string, any> {
    const filter: Record<string, any> = {};
    if (!query.include_deleted) filter.deleted_at = null;

    if (query.office_id) {
      const office = new Types.ObjectId(query.office_id);
      if (query.direction === 'in') {
        filter.to_office_id = office;
      } else if (query.direction === 'out') {
        filter.from_office_id = office;
      } else {
        // a branch's history is everything it sent and everything it received
        filter.$or = [{ from_office_id: office }, { to_office_id: office }];
      }
    }

    if (query.date_from || query.date_to) {
      const range: Record<string, Date> = {};
      if (query.date_from) range.$gte = new Date(query.date_from);
      if (query.date_to) {
        const to = new Date(query.date_to);
        if (query.date_to.length <= 10) to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      filter.created_at = range;
    }

    if (query.search?.trim()) {
      const rx = new RegExp(this.escapeRegex(query.search.trim()), 'i');
      const search = [
        { transfer_no: rx },
        { from_office_name: rx },
        { to_office_name: rx },
        { note: rx },
        { 'lines.name': rx },
        { 'lines.sku': rx },
      ];
      // keep an office filter that already used $or
      filter.$and = [...(filter.$and ?? []), { $or: search }];
      if (filter.$or) {
        filter.$and.push({ $or: filter.$or });
        delete filter.$or;
      }
    }
    return filter;
  }

  private toRow(d: StockTransferDocument): TransferRow {
    return {
      id: d._id.toString(),
      transfer_no: d.transfer_no,
      from_office_id: String(d.from_office_id),
      to_office_id: String(d.to_office_id),
      from_office_name: d.from_office_name,
      to_office_name: d.to_office_name,
      items_count: d.items_count,
      units: d.units,
      note: d.note ?? '',
      reversed: !!d.deleted_at,
      created_at: (d as unknown as { created_at?: Date }).created_at
        ? new Date((d as unknown as { created_at: Date }).created_at).toISOString()
        : null,
    };
  }

  private async office(id: string, field: string): Promise<OfficeDocument> {
    this.assertObjectId(id, field);
    const office = await this.officeModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!office) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { [field]: ['office does not exist'] },
      });
    }
    return office;
  }

  private async nextTransferNo(officeId: string): Promise<string> {
    const seq = await this.counters.next(`transfer_no:${officeId}`);
    return `TRF-${String(seq).padStart(4, '0')}`;
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
