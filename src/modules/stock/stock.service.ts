import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { QueryAdjustmentDto, SortOrder } from './dto/query-adjustment.dto';
import {
  AdjustmentType,
  StockAdjustment,
  StockAdjustmentDocument,
} from './schemas/stock-adjustment.schema';

export interface AdjustmentRow {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  type: string;
  reason: string;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  note: string;
  created_at: string | null;
}

export interface AdjustmentSummary {
  entries: number;
  units_in: number;
  units_out: number;
  net_units: number;
}

@Injectable()
export class StockService {
  constructor(
    @InjectModel(StockAdjustment.name)
    private readonly adjustmentModel: Model<StockAdjustmentDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
  ) {}

  // ---------- create ----------

  /**
   * Move stock outside a sale or a purchase and write the audit entry.
   * The product update is conditional on the count the caller acted on, so
   * two staff adjusting at the same time can never lose one another's work.
   */
  async create(
    dto: CreateAdjustmentDto,
    userId?: string,
  ): Promise<StockAdjustmentDocument> {
    await this.assertOfficeExists(dto.office_id);
    const product = await this.productModel
      .findOne({
        _id: dto.product_id,
        office_id: new Types.ObjectId(dto.office_id),
        deleted_at: null,
      })
      .exec();
    if (!product) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { product_id: ['product does not exist in this office'] },
      });
    }

    const before = product.quantity ?? 0;
    const after = this.targetQuantity(dto, before);
    const moved = Math.abs(after - before);
    if (!moved) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          quantity: [
            dto.type === AdjustmentType.RECOUNT
              ? `the counted total already matches the ${before} on file`
              : 'enter at least 1 unit',
          ],
        },
      });
    }

    // guarded on the figure we just read: a sale in between makes it fail
    const updated = await this.productModel
      .findOneAndUpdate(
        { _id: product._id, deleted_at: null, quantity: before },
        { $set: { quantity: after } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new BadRequestException(
        'Stock changed while the adjustment was being saved — reload and try again',
      );
    }

    try {
      return await this.adjustmentModel.create({
        office_id: new Types.ObjectId(dto.office_id),
        product_id: product._id,
        product_name: product.name,
        sku: product.sku ?? '',
        type: dto.type,
        reason: dto.reason,
        quantity: moved,
        before_quantity: before,
        after_quantity: after,
        note: dto.note?.trim() ?? '',
        created_by: this.toObjectIdOrNull(userId),
      });
    } catch (e) {
      // the entry is the record of the move: without it, undo the move
      await this.productModel
        .updateOne(
          { _id: product._id, quantity: after },
          { $set: { quantity: before } },
        )
        .exec();
      throw e;
    }
  }

  // ---------- read ----------

  async findAll(query: QueryAdjustmentDto): Promise<{
    data: AdjustmentRow[];
    total: number;
    page: number;
    limit: number;
    summary: AdjustmentSummary;
  }> {
    const { page, limit, sort, order } = query;
    const filter = this.buildFilter(query);
    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total, totals] = await Promise.all([
      this.adjustmentModel
        .find(filter)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.adjustmentModel.countDocuments(filter).exec(),
      this.adjustmentModel
        .aggregate<{ _id: null; units_in: number; units_out: number }>([
          { $match: filter },
          {
            $group: {
              _id: null,
              units_in: {
                $sum: {
                  $cond: [
                    { $gte: ['$after_quantity', '$before_quantity'] },
                    '$quantity',
                    0,
                  ],
                },
              },
              units_out: {
                $sum: {
                  $cond: [
                    { $lt: ['$after_quantity', '$before_quantity'] },
                    '$quantity',
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
    ]);

    const agg = totals[0];
    const unitsIn = agg?.units_in ?? 0;
    const unitsOut = agg?.units_out ?? 0;

    return {
      data: docs.map((d) => this.toRow(d)),
      total,
      page,
      limit,
      summary: {
        entries: total,
        units_in: unitsIn,
        units_out: unitsOut,
        net_units: unitsIn - unitsOut,
      },
    };
  }

  async findOne(id: string, officeId?: string): Promise<StockAdjustmentDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.adjustmentModel.findOne(filter).exec();
    if (!doc) throw new NotFoundException(`Adjustment ${id} not found`);
    return doc;
  }

  // ---------- helpers ----------

  /** what the shelf count becomes once this entry is applied */
  private targetQuantity(dto: CreateAdjustmentDto, before: number): number {
    switch (dto.type) {
      case AdjustmentType.INCREASE:
        return before + dto.quantity;
      case AdjustmentType.DECREASE: {
        if (dto.quantity > before) {
          throw new BadRequestException({
            message: 'Validation failed',
            errors: {
              quantity: [`only ${before} in stock, cannot remove ${dto.quantity}`],
            },
          });
        }
        return before - dto.quantity;
      }
      case AdjustmentType.RECOUNT:
        // the counted total replaces the figure on file, up or down
        return dto.quantity;
    }
  }

  private buildFilter(query: QueryAdjustmentDto): Record<string, any> {
    const filter: Record<string, any> = {};
    if (query.office_id) {
      filter.office_id = new Types.ObjectId(query.office_id);
    }
    if (query.product_id) {
      filter.product_id = new Types.ObjectId(query.product_id);
    }
    if (query.type) filter.type = query.type;
    if (query.reason) filter.reason = query.reason;
    if (query.date_from || query.date_to) {
      const range: Record<string, Date> = {};
      if (query.date_from) range.$gte = new Date(query.date_from);
      if (query.date_to) {
        const to = new Date(query.date_to);
        // a plain date means the whole day, not midnight
        if (query.date_to.length <= 10) to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      filter.created_at = range;
    }
    if (query.search?.trim()) {
      const rx = new RegExp(this.escapeRegex(query.search.trim()), 'i');
      filter.$or = [{ product_name: rx }, { sku: rx }, { note: rx }];
    }
    return filter;
  }

  private toRow(d: StockAdjustmentDocument): AdjustmentRow {
    return {
      id: d._id.toString(),
      product_id: String(d.product_id),
      product_name: d.product_name,
      sku: d.sku ?? '',
      type: d.type,
      reason: d.reason,
      quantity: d.quantity,
      before_quantity: d.before_quantity,
      after_quantity: d.after_quantity,
      note: d.note ?? '',
      created_at: (d as unknown as { created_at?: Date }).created_at
        ? new Date((d as unknown as { created_at: Date }).created_at).toISOString()
        : null,
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
