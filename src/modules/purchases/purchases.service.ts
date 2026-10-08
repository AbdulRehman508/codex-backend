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
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  ProductLot,
  ProductLotDocument,
} from './schemas/product-lot.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreatePurchaseDto, PurchaseLineDto } from './dto/create-purchase.dto';
import { QueryPurchaseDto, SortOrder } from './dto/query-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import {
  ACTIVE_PURCHASE_STATUSES,
  Purchase,
  PurchaseDocument,
  PurchaseLine,
  PurchaseStatus,
} from './schemas/purchase.schema';

const LIST_FIELDS =
  'purchase_no supplier_name supplier_invoice_no items_count total paid_amount due_amount status created_at';

export interface PurchaseListRow {
  id: string;
  purchase_no: string;
  supplier_name: string;
  supplier_invoice_no: string;
  items_count: number;
  total: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  created_at: string | null;
}

export interface PurchaseStats {
  purchases: number;
  total: number;
  paid: number;
  due: number;
}

@Injectable()
export class PurchasesService {
  constructor(
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    @InjectModel(ProductLot.name)
    private readonly lotModel: Model<ProductLotDocument>,
    private readonly counters: CountersService,
    private readonly suppliers: SuppliersService,
  ) {}

  // ---------- create ----------

  async create(
    dto: CreatePurchaseDto,
    userId?: string,
  ): Promise<PurchaseDocument> {
    await this.assertOfficeExists(dto.office_id);
    const supplier = await this.suppliers.findOne(
      dto.supplier_id,
      dto.office_id,
    );

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

    const total = round2(subtotal - discount);
    const paid_amount = round2(Math.min(Math.max(dto.paid_amount ?? total, 0), total));
    const due_amount = round2(total - paid_amount);
    const status = dto.status ?? PurchaseStatus.RECEIVED;

    // stock goes up before the bill is written, so a failed write leaves nothing
    if (this.holdsStock(status)) {
      await this.applyStock(this.stockDelta(lines), 1);
    }

    try {
      const purchase = await this.purchaseModel.create({
        office_id: new Types.ObjectId(dto.office_id),
        purchase_no: await this.nextPurchaseNo(dto.office_id),
        supplier_id: supplier._id,
        supplier_name: supplier.name,
        supplier_invoice_no: dto.supplier_invoice_no?.trim() ?? '',
        lines,
        items_count,
        subtotal,
        discount,
        total,
        paid_amount,
        due_amount,
        status,
        notes: dto.notes?.trim() ?? '',
        created_by: this.toObjectIdOrNull(userId),
      });

      if (this.holdsStock(status)) {
        await this.rememberCost(lines);
        await this.syncLots(purchase);
        if (due_amount > 0) {
          await this.suppliers.adjustPayable(supplier._id, due_amount);
        }
      }
      return purchase;
    } catch (e) {
      if (this.holdsStock(status)) {
        await this.applyStock(this.stockDelta(lines), -1);
      }
      throw e;
    }
  }

  // ---------- read ----------

  async findAll(query: QueryPurchaseDto): Promise<{
    data: PurchaseListRow[];
    total: number;
    page: number;
    limit: number;
    summary: PurchaseStats;
  }> {
    const { page, limit, sort, order } = query;
    const filter = this.buildFilter(query);
    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total, summary] = await Promise.all([
      this.purchaseModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.purchaseModel.countDocuments(filter).exec(),
      this.summary(filter),
    ]);

    const data: PurchaseListRow[] = docs.map((d) => {
      const json = d.toJSON() as { created_at?: string };
      return {
        id: d._id.toString(),
        purchase_no: d.purchase_no,
        supplier_name: d.supplier_name,
        supplier_invoice_no: d.supplier_invoice_no ?? '',
        items_count: d.items_count,
        total: d.total,
        paid_amount: d.paid_amount,
        due_amount: d.due_amount,
        status: d.status,
        created_at: json.created_at ?? null,
      };
    });

    return { data, total, page, limit, summary };
  }

  async findOne(id: string, officeId?: string): Promise<PurchaseDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.purchaseModel.findOne(filter).exec();
    if (!doc) throw new NotFoundException(`Purchase ${id} not found`);
    return doc;
  }

  private async summary(filter: Record<string, any>): Promise<PurchaseStats> {
    const live = { $ne: ['$status', PurchaseStatus.CANCELLED] };
    const [row] = await this.purchaseModel
      .aggregate<{ purchases: number; total: number; paid: number; due: number }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            purchases: { $sum: { $cond: [live, 1, 0] } },
            total: { $sum: { $cond: [live, '$total', 0] } },
            paid: { $sum: { $cond: [live, '$paid_amount', 0] } },
            due: { $sum: { $cond: [live, '$due_amount', 0] } },
          },
        },
      ])
      .exec();
    return {
      purchases: row?.purchases ?? 0,
      total: round2(row?.total ?? 0),
      paid: round2(row?.paid ?? 0),
      due: round2(row?.due ?? 0),
    };
  }

  // ---------- update ----------

  async update(
    id: string,
    dto: UpdatePurchaseDto,
    userId?: string,
  ): Promise<PurchaseDocument> {
    return this.applyUpdate(id, dto, userId);
  }

  async patch(
    id: string,
    dto: UpdatePurchaseDto,
    userId?: string,
  ): Promise<PurchaseDocument> {
    return this.applyUpdate(id, dto, userId);
  }

  // ---------- delete ----------

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const purchase = await this.findOne(id);
    await this.releaseStockAndPayable(purchase);
    purchase.deleted_at = new Date();
    await purchase.save();
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const purchases = await this.purchaseModel
      .find({ _id: { $in: dto.ids }, deleted_at: null })
      .exec();

    let deleted = 0;
    for (const purchase of purchases) {
      await this.releaseStockAndPayable(purchase);
      purchase.deleted_at = new Date();
      await purchase.save();
      deleted++;
    }
    return { deleted_count: deleted };
  }

  // ---------- helpers ----------

  private async applyUpdate(
    id: string,
    dto: UpdatePurchaseDto,
    userId?: string,
  ): Promise<PurchaseDocument> {
    const purchase = await this.findOne(id);
    const officeId = purchase.office_id.toString();

    if (dto.office_id && dto.office_id !== officeId) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['a purchase cannot be moved to another office'] },
      });
    }

    const supplier = dto.supplier_id
      ? await this.suppliers.findOne(dto.supplier_id, officeId)
      : null;

    const nextStatus = dto.status ?? purchase.status;
    const built = dto.lines
      ? await this.buildLines(dto.lines, officeId)
      : {
          lines: purchase.lines,
          items_count: purchase.items_count,
          subtotal: purchase.subtotal,
        };

    const discount = dto.discount ?? purchase.discount;
    if (discount > built.subtotal) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { discount: ['discount cannot exceed the subtotal'] },
      });
    }

    const total = round2(built.subtotal - discount);
    const paid_amount = round2(
      Math.min(Math.max(dto.paid_amount ?? purchase.paid_amount, 0), total),
    );
    const due_amount = round2(total - paid_amount);

    // stock: what this bill adds now vs what it will add after the edit
    const before = this.holdsStock(purchase.status)
      ? this.stockDelta(purchase.lines)
      : new Map<string, number>();
    const after = this.holdsStock(nextStatus)
      ? this.stockDelta(built.lines)
      : new Map<string, number>();
    await this.applyStockDiff(before, after);

    // payable moves off the old supplier and onto the new one
    const payableBefore = this.holdsStock(purchase.status)
      ? purchase.due_amount
      : 0;
    const payableAfter = this.holdsStock(nextStatus) ? due_amount : 0;
    const oldSupplier = purchase.supplier_id;
    const newSupplier = supplier?._id ?? purchase.supplier_id;

    if (oldSupplier.toString() === newSupplier.toString()) {
      await this.suppliers.adjustPayable(
        newSupplier,
        round2(payableAfter - payableBefore),
      );
    } else {
      if (payableBefore) await this.suppliers.adjustPayable(oldSupplier, -payableBefore);
      if (payableAfter) await this.suppliers.adjustPayable(newSupplier, payableAfter);
    }

    if (supplier) {
      purchase.supplier_id = supplier._id;
      purchase.supplier_name = supplier.name;
    }
    if (dto.supplier_invoice_no !== undefined) {
      purchase.supplier_invoice_no = dto.supplier_invoice_no.trim();
    }
    if (dto.notes !== undefined) purchase.notes = dto.notes.trim();
    purchase.lines = built.lines;
    purchase.items_count = built.items_count;
    purchase.subtotal = built.subtotal;
    purchase.discount = discount;
    purchase.total = total;
    purchase.paid_amount = paid_amount;
    purchase.due_amount = due_amount;
    purchase.status = nextStatus;
    const editor = this.toObjectIdOrNull(userId);
    if (editor) purchase.created_by = purchase.created_by ?? editor;

    const saved = await purchase.save();
    await this.syncLots(saved);
    if (this.holdsStock(nextStatus)) {
      await this.rememberCost(built.lines);
    }
    return saved;
  }

  /** Take back the stock this bill added and clear what it made payable. */
  private async releaseStockAndPayable(purchase: PurchaseDocument) {
    await this.lotModel.deleteMany({ purchase_id: purchase._id }).exec();
    if (!this.holdsStock(purchase.status)) return;
    await this.applyStock(this.stockDelta(purchase.lines), -1);
    if (purchase.due_amount) {
      await this.suppliers.adjustPayable(purchase.supplier_id, -purchase.due_amount);
    }
  }

  /**
   * Keep the lot register in step with the bill: one entry per line that
   * carries a batch number or an expiry date. Lines without either are
   * ordinary stock and need no lot.
   */
  private async syncLots(purchase: PurchaseDocument) {
    await this.lotModel.deleteMany({ purchase_id: purchase._id }).exec();
    if (!this.holdsStock(purchase.status)) return;

    const lots = purchase.lines
      .filter((l) => l.batch_no?.trim() || l.expiry_date)
      .map((l) => ({
        office_id: purchase.office_id,
        product_id: l.product_id,
        product_name: l.name,
        sku: l.sku ?? '',
        batch_no: l.batch_no?.trim() ?? '',
        expiry_date: l.expiry_date ?? null,
        quantity: l.quantity,
        cost_price: l.cost_price,
        purchase_id: purchase._id,
        purchase_no: purchase.purchase_no,
        supplier_name: purchase.supplier_name,
      }));
    if (lots.length) await this.lotModel.insertMany(lots);
  }

  /**
   * Resolve each line against a live product of the same office and snapshot
   * its name / sku. Unlike a sale, a purchase may receive an inactive product
   * — that is how it comes back into circulation.
   */
  private async buildLines(
    dtoLines: PurchaseLineDto[],
    officeId: string,
  ): Promise<{ lines: PurchaseLine[]; items_count: number; subtotal: number }> {
    const ids = dtoLines.map((l) => l.product_id);
    ids.forEach((id) => this.assertObjectId(id, 'product_id'));

    const products = await this.productModel
      .find({ _id: { $in: ids }, deleted_at: null })
      .exec();
    const byId = new Map(products.map((p) => [p._id.toString(), p]));

    const lines: PurchaseLine[] = dtoLines.map((l) => {
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
      return {
        product_id: product._id,
        name: product.name,
        sku: product.sku,
        cost_price: l.cost_price,
        quantity: l.quantity,
        total: round2(l.cost_price * l.quantity),
        batch_no: l.batch_no?.trim() ?? '',
        expiry_date: l.expiry_date ? new Date(l.expiry_date) : null,
      };
    });

    return {
      lines,
      items_count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: round2(lines.reduce((sum, l) => sum + l.total, 0)),
    };
  }

  private holdsStock(status: PurchaseStatus): boolean {
    return ACTIVE_PURCHASE_STATUSES.includes(status);
  }

  /** units per product this bill brings in */
  private stockDelta(lines: PurchaseLine[]): Map<string, number> {
    const delta = new Map<string, number>();
    for (const line of lines) {
      const key = line.product_id.toString();
      delta.set(key, (delta.get(key) ?? 0) + line.quantity);
    }
    return delta;
  }

  /** `sign` 1 adds the units, -1 takes them back */
  private async applyStock(delta: Map<string, number>, sign: 1 | -1) {
    const diff = new Map<string, number>();
    for (const [productId, qty] of delta) diff.set(productId, qty * sign);
    await this.commitStock(diff);
  }

  private async applyStockDiff(
    before: Map<string, number>,
    after: Map<string, number>,
  ) {
    const diff = new Map<string, number>();
    for (const [id, qty] of before) diff.set(id, (diff.get(id) ?? 0) - qty);
    for (const [id, qty] of after) diff.set(id, (diff.get(id) ?? 0) + qty);
    await this.commitStock(diff);
  }

  /**
   * Apply the movement. Removals are conditional in the same query, so taking
   * back a received bill can never drive stock negative — if the goods were
   * already sold, the reversal is refused instead of silently corrupting
   * the count.
   */
  private async commitStock(diff: Map<string, number>) {
    const entries = [...diff.entries()].filter(([, d]) => d !== 0);
    if (!entries.length) return;

    const adds = entries.filter(([, d]) => d > 0);
    const removals = entries.filter(([, d]) => d < 0);

    await Promise.all(
      adds.map(([productId, d]) =>
        this.productModel
          .updateOne({ _id: productId }, { $inc: { quantity: d } })
          .exec(),
      ),
    );

    const applied: [string, number][] = [];
    try {
      for (const [productId, d] of removals) {
        const wanted = -d;
        const res = await this.productModel
          .findOneAndUpdate(
            { _id: productId, deleted_at: null, quantity: { $gte: wanted } },
            { $inc: { quantity: d } },
            { new: true },
          )
          .select('name quantity')
          .exec();
        if (!res) {
          const product = await this.productModel
            .findOne({ _id: productId, deleted_at: null })
            .select('name quantity')
            .exec();
          throw new BadRequestException({
            message: 'Validation failed',
            errors: {
              lines: [
                product
                  ? `"${product.name}" only has ${product.quantity} in stock — ${wanted} of this purchase has already been sold`
                  : `product ${productId} does not exist`,
              ],
            },
          });
        }
        applied.push([productId, d]);
      }
    } catch (e) {
      await Promise.all([
        ...applied.map(([productId, d]) =>
          this.productModel
            .updateOne({ _id: productId }, { $inc: { quantity: -d } })
            .exec(),
        ),
        ...adds.map(([productId, d]) =>
          this.productModel
            .updateOne({ _id: productId }, { $inc: { quantity: -d } })
            .exec(),
        ),
      ]);
      throw e;
    }
  }

  /** latest landed cost per product, for margin reporting */
  private async rememberCost(lines: PurchaseLine[]) {
    await Promise.all(
      lines.map((l) =>
        this.productModel
          .updateOne({ _id: l.product_id }, { cost_price: l.cost_price })
          .exec(),
      ),
    );
  }

  private buildFilter(query: QueryPurchaseDto): Record<string, any> {
    const filter: Record<string, any> = { deleted_at: null };
    if (query.office_id) filter.office_id = new Types.ObjectId(query.office_id);
    if (query.supplier_id) filter.supplier_id = new Types.ObjectId(query.supplier_id);
    if (query.status) filter.status = query.status;
    if (query.due_only) filter.due_amount = { $gt: 0 };

    const range: Record<string, Date> = {};
    if (query.date_from) range.$gte = new Date(query.date_from);
    if (query.date_to) {
      const end = new Date(query.date_to);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    if (Object.keys(range).length) filter.created_at = range;

    if (query.search?.trim()) {
      const rx = new RegExp(this.escapeRegex(query.search.trim()), 'i');
      filter.$or = [
        { purchase_no: rx },
        { supplier_name: rx },
        { supplier_invoice_no: rx },
      ];
    }
    return filter;
  }

  /** PUR-0001, sequential inside the office */
  private async nextPurchaseNo(officeId: string): Promise<string> {
    const seq = await this.counters.next(`purchase_no:${officeId}`);
    return `PUR-${String(seq).padStart(4, '0')}`;
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
