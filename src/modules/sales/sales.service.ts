import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerDocument } from '../customers/schemas/customer.schema';
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
  PaymentMethod,
  Sale,
  SaleDocument,
  SaleLine,
  SaleStatus,
  STOCK_HOLDING_STATUSES,
} from './schemas/sale.schema';

// columns loaded for the list grid
const LIST_FIELDS =
  'invoice_no customer_name items_count payment_method total paid_amount borrow_amount is_borrow status created_at';

export interface SaleListRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  items_count: number;
  payment_method: string;
  total: number;
  paid_amount: number;
  borrow_amount: number;
  is_borrow: boolean;
  status: string;
  created_at: string | null;
}

export interface SaleStats {
  /** takings for the filtered range (today when no date filter is given) */
  today_total: number;
  transactions: number;
  average_order: number;
  /** still owed across the filtered sales */
  borrow_total: number;
  paid_total: number;
  cash_total: number;
  online_total: number;
  /** true when the numbers cover today only */
  is_today: boolean;
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
    private readonly customers: CustomersService,
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
    const total = round2(subtotal - discount);
    const { paid_amount, borrow_amount } = this.splitPayment(dto, total);
    // a borrowed sale needs someone to owe the money
    const customer = await this.resolveCustomer(dto, borrow_amount);

    // take the stock before writing the sale, so an oversell fails cleanly
    if (this.holdsStock(status)) {
      await this.applyStock(this.stockNeed(lines), 'take');
    }

    try {
      const sale = await this.saleModel.create({
        office_id: new Types.ObjectId(dto.office_id),
        invoice_no: await this.nextInvoiceNo(dto.office_id),
        customer_id: customer?._id ?? null,
        customer_name:
          customer
            ? `${customer.first_name} ${customer.last_name}`.trim()
            : dto.customer_name?.trim() || 'Walk-in',
        customer_mobile: customer?.mobile_no ?? dto.customer_mobile ?? null,
        is_borrow: !!dto.is_borrow,
        payment_method: dto.payment_method,
        lines,
        items_count,
        subtotal,
        discount,
        total,
        paid_amount,
        borrow_amount,
        status,
        sold_by: this.toObjectIdOrNull(userId),
      });

      // put the unpaid part on the customer's running balance
      if (customer && borrow_amount > 0 && this.holdsStock(status)) {
        await this.customers.adjustBorrow(customer._id, borrow_amount);
      }
      return sale;
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
      .select(
        'office_name office_address office_mobile_no office_logo payment_methods',
      )
      .exec();
    return {
      ...(sale.toJSON() as Record<string, any>),
      office_name: office?.office_name ?? null,
      office_logo: office?.office_logo ?? null,
      office_address: office?.office_address ?? null,
      office_mobile_no: office?.office_mobile_no ?? null,
      // scan-to-pay QRs printed at the foot of online-sale receipts
      office_payment_methods: office?.payment_methods ?? [],
    };
  }

  /**
   * Chips above the grid. They follow whatever filters the grid has applied;
   * with no date filter they fall back to today, which is what the default
   * "Today's Sales" chip means.
   */
  async stats(query: QuerySaleDto): Promise<SaleStats> {
    const { office_id, search, status, payment_method, date_from, date_to } =
      query;

    const match: Record<string, any> = { deleted_at: null };
    if (office_id) {
      this.assertObjectId(office_id, 'office_id');
      match.office_id = new Types.ObjectId(office_id);
    }
    // an explicit status filter wins; otherwise refunds never count as takings
    if (status) {
      match.status = status;
    } else {
      match.status = { $ne: SaleStatus.REFUNDED };
    }
    if (payment_method) {
      match.payment_method = payment_method;
    }
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      match.$or = [{ invoice_no: rx }, { customer_name: rx }];
    }

    const range = this.dateRange(date_from, date_to);
    const isToday = !range;
    if (range) {
      match.created_at = range;
    } else {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      match.created_at = { $gte: start };
    }

    const [row] = await this.saleModel
      .aggregate<{
        today_total: number;
        transactions: number;
        borrow_total: number;
        paid_total: number;
        cash_total: number;
        online_total: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            today_total: { $sum: '$total' },
            transactions: { $sum: 1 },
            borrow_total: { $sum: { $ifNull: ['$borrow_amount', 0] } },
            paid_total: {
              $sum: { $ifNull: ['$paid_amount', '$total'] },
            },
            cash_total: {
              $sum: {
                $cond: [
                  { $eq: ['$payment_method', PaymentMethod.CASH] },
                  '$total',
                  0,
                ],
              },
            },
            online_total: {
              $sum: {
                $cond: [
                  { $eq: ['$payment_method', PaymentMethod.ONLINE] },
                  '$total',
                  0,
                ],
              },
            },
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
      borrow_total: round2(row?.borrow_total ?? 0),
      paid_total: round2(row?.paid_total ?? 0),
      cash_total: round2(row?.cash_total ?? 0),
      online_total: round2(row?.online_total ?? 0),
      is_today: isToday,
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
    // a deleted sale no longer holds stock, nor is anything still owed for it
    if (this.holdsStock(sale.status)) {
      await this.applyStock(this.stockNeed(sale.lines), 'give');
    }
    await this.releaseBorrow(sale);
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
      await this.releaseBorrow(sale);
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

    const total = round2(built.subtotal - discount);
    const isBorrow = dto.is_borrow ?? sale.is_borrow;
    const { paid_amount, borrow_amount } = this.splitPayment(
      { is_borrow: isBorrow, paid_amount: dto.paid_amount ?? sale.paid_amount },
      total,
    );
    const borrowBefore = this.borrowHold(sale);
    const customer = await this.resolveCustomer(
      {
        ...dto,
        office_id: officeId,
        customer_id: dto.customer_id ?? sale.customer_id?.toString() ?? null,
        customer_name: dto.customer_name ?? sale.customer_name,
        customer_mobile: dto.customer_mobile ?? sale.customer_mobile,
        is_borrow: isBorrow,
      },
      borrow_amount,
    );

    if (customer) {
      sale.customer_id = customer._id;
      sale.customer_name = `${customer.first_name} ${customer.last_name}`.trim();
      sale.customer_mobile = customer.mobile_no;
    } else {
      sale.customer_id = null;
      sale.customer_name = dto.customer_name?.trim() || sale.customer_name;
      sale.customer_mobile = dto.customer_mobile ?? sale.customer_mobile;
    }
    sale.is_borrow = isBorrow;
    sale.payment_method = dto.payment_method ?? sale.payment_method;
    sale.lines = built.lines;
    sale.items_count = built.items_count;
    sale.subtotal = built.subtotal;
    sale.discount = discount;
    sale.total = total;
    sale.paid_amount = paid_amount;
    sale.borrow_amount = borrow_amount;
    sale.status = nextStatus;
    const editor = this.toObjectIdOrNull(userId);
    if (editor) {
      sale.sold_by = editor;
    }

    const saved = await sale.save();
    // move the owed amount off the old customer and onto the new one
    await this.applyBorrowDiff(borrowBefore, this.borrowHold(saved));
    return saved;
  }

  /** Split the total into what was paid now and what stays owed. */
  private splitPayment(
    dto: { is_borrow?: boolean; paid_amount?: number },
    total: number,
  ): { paid_amount: number; borrow_amount: number } {
    // not a credit sale => paid in full, nothing owed
    if (!dto.is_borrow) {
      return { paid_amount: total, borrow_amount: 0 };
    }
    const paid = Math.min(Math.max(dto.paid_amount ?? total, 0), total);
    return {
      paid_amount: round2(paid),
      borrow_amount: round2(total - paid),
    };
  }

  /**
   * Who owes the money: the picked customer, or one created from the typed
   * name + mobile. Only a borrowed sale needs it.
   */
  private async resolveCustomer(
    dto: {
      office_id?: string;
      customer_id?: string | null;
      customer_name?: string;
      customer_mobile?: string | null;
      is_borrow?: boolean;
    },
    borrowAmount: number,
    fallbackOfficeId?: string,
  ): Promise<CustomerDocument | null> {
    const officeId = dto.office_id ?? fallbackOfficeId;
    if (!officeId) return null;

    // an explicitly picked customer always wins, borrowed or not
    if (dto.customer_id) {
      return this.customers.findOne(dto.customer_id, officeId);
    }
    if (!dto.is_borrow || borrowAmount <= 0) return null;

    if (!dto.customer_mobile?.trim()) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          customer_mobile: [
            'pick a customer or enter a mobile no to sell on credit',
          ],
        },
      });
    }
    return this.customers.findOrCreateForSale(officeId, {
      name: dto.customer_name,
      mobile_no: dto.customer_mobile,
    });
  }

  /** Move the owed amount between customers after an edit. */
  private async applyBorrowDiff(
    before: { customerId: Types.ObjectId | null; amount: number },
    after: { customerId: Types.ObjectId | null; amount: number },
  ) {
    const sameCustomer =
      before.customerId &&
      after.customerId &&
      before.customerId.toString() === after.customerId.toString();

    if (sameCustomer) {
      await this.customers.adjustBorrow(
        after.customerId!,
        round2(after.amount - before.amount),
      );
      return;
    }
    if (before.customerId && before.amount) {
      await this.customers.adjustBorrow(before.customerId, -before.amount);
    }
    if (after.customerId && after.amount) {
      await this.customers.adjustBorrow(after.customerId, after.amount);
    }
  }

  /** Take this sale's owed amount off the customer entirely. */
  private async releaseBorrow(sale: SaleDocument) {
    const hold = this.borrowHold(sale);
    if (hold.customerId && hold.amount) {
      await this.customers.adjustBorrow(hold.customerId, -hold.amount);
    }
  }

  /** What this sale currently charges to a customer's balance. */
  private borrowHold(sale: SaleDocument): {
    customerId: Types.ObjectId | null;
    amount: number;
  } {
    const active = this.holdsStock(sale.status);
    return {
      customerId: sale.customer_id ?? null,
      amount: active ? (sale.borrow_amount ?? 0) : 0,
    };
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
      paid_amount: d.paid_amount ?? d.total,
      borrow_amount: d.borrow_amount ?? 0,
      is_borrow: d.is_borrow ?? false,
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
