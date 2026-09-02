import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from '../products/schemas/product.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateSaleDto, SaleLineDto } from './dto/create-sale.dto';
import { QuerySaleDto, SortOrder } from './dto/query-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import {
  Sale,
  SaleDocument,
  SaleLine,
  SaleStatus,
  STOCK_HOLDING_STATUSES,
} from './schemas/sale.schema';

// columns loaded for the list grid
const LIST_FIELDS =
  'invoice_no customer_name items_count payment_method total status created_at';

export interface SaleListRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  items_count: number;
  payment_method: string;
  total: number;
  status: string;
  created_at: string | null;
}

export interface SaleStats {
  today_total: number;
  transactions: number;
  average_order: number;
}

@Injectable()
export class SalesService {
  constructor(
    @InjectModel(Sale.name)
    private readonly saleModel: Model<SaleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    private readonly counters: CountersService,
  ) {}

  // ---------- create ----------

  async create(dto: CreateSaleDto, userId?: string): Promise<SaleDocument> {
    await this.assertOfficeExists(dto.office_id);

    const { lines, items_count, subtotal } = await this.buildLines(
      dto.lines,
      dto.office_id,
    );
    const discount = dto.discount ?? 0;
    if (discount > subtotal) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { discount: ['discount cannot exceed the subtotal'] },
      });
    }

    const status = dto.status ?? SaleStatus.COMPLETED;
    // take the stock before writing the sale, so an oversell fails cleanly
    if (this.holdsStock(status)) {
      await this.applyStock(this.stockNeed(lines), 'take');
    }

    try {
      return await this.saleModel.create({
        office_id: new Types.ObjectId(dto.office_id),
        invoice_no: await this.nextInvoiceNo(dto.office_id),
        customer_name: dto.customer_name?.trim() || 'Walk-in',
        payment_method: dto.payment_method,
        lines,
        items_count,
        subtotal,
        discount,
        total: round2(subtotal - discount),
        status,
        sold_by: this.toObjectIdOrNull(userId),
      });
    } catch (e) {
      // put the stock back if the write failed
      if (this.holdsStock(status)) {
        await this.applyStock(this.stockNeed(lines), 'give');
      }
      throw e;
    }
  }

  // ---------- read ----------

  async findAll(query: QuerySaleDto): Promise<{
    data: SaleListRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const {
      page,
      limit,
      search,
      office_id,
      status,
      payment_method,
      date_from,
      date_to,
      sort,
      order,
    } = query;

    const filter: Record<string, any> = { deleted_at: null };
    if (office_id) {
      filter.office_id = new Types.ObjectId(office_id);
    }
    if (status) {
      filter.status = status;
    }
    if (payment_method) {
      filter.payment_method = payment_method;
    }
    const range = this.dateRange(date_from, date_to);
    if (range) {
      filter.created_at = range;
    }
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [{ invoice_no: rx }, { customer_name: rx }];
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.saleModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.saleModel.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((d) => this.toListRow(d)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, officeId?: string): Promise<SaleDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.saleModel.findOne(filter).exec();
    if (!doc) {
      throw new NotFoundException(`Sale ${id} not found`);
    }
    return doc;
  }

  /** Sale plus the shop name — the printed receipt header needs it. */
  async findOneDetail(
    id: string,
    officeId?: string,
  ): Promise<Record<string, any>> {
    const sale = await this.findOne(id, officeId);
    const office = await this.officeModel
      .findById(sale.office_id)
      .select('office_name office_address office_mobile_no')
      .exec();
    return {
      ...(sale.toJSON() as Record<string, any>),
      office_name: office?.office_name ?? null,
      office_address: office?.office_address ?? null,
      office_mobile_no: office?.office_mobile_no ?? null,
    };
  }

  /** Chips above the grid: today's takings, transaction count, average order. */
  async stats(officeId?: string): Promise<SaleStats> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const match: Record<string, any> = {
      deleted_at: null,
      status: { $ne: SaleStatus.REFUNDED },
      created_at: { $gte: start },
    };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      match.office_id = new Types.ObjectId(officeId);
    }

    const [row] = await this.saleModel
      .aggregate<{ today_total: number; transactions: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            today_total: { $sum: '$total' },
            transactions: { $sum: 1 },
          },
        },
      ])
      .exec();

    const today_total = round2(row?.today_total ?? 0);
    const transactions = row?.transactions ?? 0;
    return {
      today_total,
      transactions,
      average_order: transactions ? round2(today_total / transactions) : 0,
    };
  }

  // ---------- update ----------

  async update(
    id: string,
    dto: UpdateSaleDto,
    userId?: string,
  ): Promise<SaleDocument> {
    return this.applyUpdate(id, dto, userId);
  }

  async patch(
    id: string,
    dto: UpdateSaleDto,
    userId?: string,
  ): Promise<SaleDocument> {
    return this.applyUpdate(id, dto, userId);
  }

  // ---------- delete ----------

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const sale = await this.findOne(id);
    // a deleted sale no longer holds stock
    if (this.holdsStock(sale.status)) {
      await this.applyStock(this.stockNeed(sale.lines), 'give');
    }
    sale.deleted_at = new Date();
    await sale.save();
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const sales = await this.saleModel
      .find({ _id: { $in: dto.ids }, deleted_at: null })
      .exec();

    let deleted = 0;
    for (const sale of sales) {
      if (this.holdsStock(sale.status)) {
        await this.applyStock(this.stockNeed(sale.lines), 'give');
      }
      sale.deleted_at = new Date();
      await sale.save();
      deleted++;
    }
    return { deleted_count: deleted };
  }

  // ---------- helpers ----------

  private async applyUpdate(
    id: string,
    dto: UpdateSaleDto,
    userId?: string,
  ): Promise<SaleDocument> {
    const sale = await this.findOne(id);
    const officeId = sale.office_id.toString();

    // a sale cannot move between offices — its stock came out of this one
    if (dto.office_id && dto.office_id !== officeId) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['a sale cannot be moved to another office'] },
      });
    }

    const nextStatus = dto.status ?? sale.status;
    const built = dto.lines
      ? await this.buildLines(dto.lines, officeId)
      : {
          lines: sale.lines,
          items_count: sale.items_count,
          subtotal: sale.subtotal,
        };

    const discount = dto.discount ?? sale.discount;
    if (discount > built.subtotal) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { discount: ['discount cannot exceed the subtotal'] },
      });
    }

    // stock this sale holds now vs what it will hold after the edit
    const before = this.holdsStock(sale.status)
      ? this.stockNeed(sale.lines)
      : new Map<string, number>();
    const after = this.holdsStock(nextStatus)
      ? this.stockNeed(built.lines)
      : new Map<string, number>();
    await this.applyStockDiff(before, after);

    sale.customer_name = dto.customer_name?.trim() || sale.customer_name;
    sale.payment_method = dto.payment_method ?? sale.payment_method;
    sale.lines = built.lines;
    sale.items_count = built.items_count;
    sale.subtotal = built.subtotal;
    sale.discount = discount;
    sale.total = round2(built.subtotal - discount);
    sale.status = nextStatus;
    const editor = this.toObjectIdOrNull(userId);
    if (editor) {
      sale.sold_by = editor;
    }

    return sale.save();
  }

  /**
   * Resolve each line against a live product of the same office and snapshot
   * name / sku / price. Rejects unknown, inactive or foreign products.
   */
  private async buildLines(
    dtoLines: SaleLineDto[],
    officeId: string,
  ): Promise<{ lines: SaleLine[]; items_count: number; subtotal: number }> {
    const ids = dtoLines.map((l) => l.product_id);
    ids.forEach((id) => this.assertObjectId(id, 'product_id'));

    const products = await this.productModel
      .find({ _id: { $in: ids }, deleted_at: null })
      .exec();
    const byId = new Map(products.map((p) => [p._id.toString(), p]));

    const lines: SaleLine[] = dtoLines.map((l) => {
      const product = byId.get(l.product_id);
      if (!product) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: { lines: [`product ${l.product_id} does not exist`] },
        });
      }
      if (product.office_id.toString() !== officeId) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: {
            lines: [`product "${product.name}" belongs to another office`],
          },
        });
      }
      if (product.status !== ProductStatus.ACTIVE) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: { lines: [`product "${product.name}" is inactive`] },
        });
      }
      const price = l.price ?? product.price;
      return {
        product_id: product._id,
        name: product.name,
        sku: product.sku,
        price,
        quantity: l.quantity,
        total: round2(price * l.quantity),
      };
    });

    return {
      lines,
      items_count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: round2(lines.reduce((sum, l) => sum + l.total, 0)),
    };
  }

  private holdsStock(status: SaleStatus): boolean {
    return STOCK_HOLDING_STATUSES.includes(status);
  }

  /** units per product that a set of lines takes out of stock */
  private stockNeed(lines: SaleLine[]): Map<string, number> {
    const need = new Map<string, number>();
    for (const line of lines) {
      const key = line.product_id.toString();
      need.set(key, (need.get(key) ?? 0) + line.quantity);
    }
    return need;
  }

  /** take from / give back to stock in one pass */
  private async applyStock(
    need: Map<string, number>,
    direction: 'take' | 'give',
  ) {
    const diff = new Map<string, number>();
    for (const [productId, qty] of need) {
      diff.set(productId, direction === 'take' ? -qty : qty);
    }
    await this.commitStock(diff);
  }

  /** move stock from what the sale held before to what it holds after */
  private async applyStockDiff(
    before: Map<string, number>,
    after: Map<string, number>,
  ) {
    const diff = new Map<string, number>();
    for (const [productId, qty] of before) {
      diff.set(productId, (diff.get(productId) ?? 0) + qty);
    }
    for (const [productId, qty] of after) {
      diff.set(productId, (diff.get(productId) ?? 0) - qty);
    }
    await this.commitStock(diff);
  }

  /** check every decrease has stock behind it, then $inc each product */
  private async commitStock(diff: Map<string, number>) {
    const entries = [...diff.entries()].filter(([, delta]) => delta !== 0);
    if (!entries.length) return;

    const takes = entries.filter(([, delta]) => delta < 0);
    if (takes.length) {
      const products = await this.productModel
        .find({ _id: { $in: takes.map(([id]) => id) }, deleted_at: null })
        .select('name quantity')
        .exec();
      const byId = new Map(products.map((p) => [p._id.toString(), p]));
      for (const [productId, delta] of takes) {
        const product = byId.get(productId);
        const wanted = -delta;
        if (!product) {
          throw new BadRequestException({
            message: 'Validation failed',
            errors: { lines: [`product ${productId} does not exist`] },
          });
        }
        if (product.quantity < wanted) {
          throw new BadRequestException({
            message: 'Validation failed',
            errors: {
              lines: [
                `"${product.name}" has only ${product.quantity} in stock, ${wanted} requested`,
              ],
            },
          });
        }
      }
    }

    await Promise.all(
      entries.map(([productId, delta]) =>
        this.productModel
          .updateOne({ _id: productId }, { $inc: { quantity: delta } })
          .exec(),
      ),
    );
  }

  /** INV-0001, sequential inside the office */
  private async nextInvoiceNo(officeId: string): Promise<string> {
    const seq = await this.counters.next(`sale_invoice:${officeId}`);
    return `INV-${String(seq).padStart(4, '0')}`;
  }

  private toListRow(d: SaleDocument): SaleListRow {
    const json = d.toJSON() as { created_at?: string };
    return {
      id: d._id.toString(),
      invoice_no: d.invoice_no,
      customer_name: d.customer_name,
      items_count: d.items_count,
      payment_method: d.payment_method,
      total: d.total,
      status: d.status,
      created_at: json.created_at ?? null,
    };
  }

  private dateRange(from?: string, to?: string): Record<string, Date> | null {
    const range: Record<string, Date> = {};
    if (from) {
      range.$gte = new Date(from);
    }
    if (to) {
      // inclusive: cover the whole "to" day
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    return Object.keys(range).length ? range : null;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
