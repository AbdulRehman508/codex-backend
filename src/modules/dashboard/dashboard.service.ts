import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from '../products/schemas/product.schema';
import {
  ACTIVE_PURCHASE_STATUSES,
  Purchase,
  PurchaseDocument,
} from '../purchases/schemas/purchase.schema';
import {
  PaymentMethod,
  Sale,
  SaleDocument,
  SaleStatus,
} from '../sales/schemas/sale.schema';
import {
  Supplier,
  SupplierDocument,
} from '../suppliers/schemas/supplier.schema';
import { QueryDashboardDto } from './dto/query-dashboard.dto';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// ranges up to a day and a half chart by the hour, longer ones by the day
const HOURLY_LIMIT_MS = 36 * HOUR_MS;

export type Granularity = 'hour' | 'day';

/** A figure for the selected period next to the same window a period earlier. */
export interface Compared {
  value: number;
  previous: number;
}

export interface DashboardOverview {
  range: { from: string; to: string; granularity: Granularity; tz: string };
  kpis: {
    revenue: Compared;
    orders: Compared;
    new_customers: Compared;
    refunds: Compared;
    /** what customers owe right now — a balance, not a period figure */
    outstanding_borrow: number;
    /** value of the stock bought in from suppliers during the period */
    purchases: Compared;
    /** what this office owes suppliers right now — also a balance */
    outstanding_payable: number;
  };
  /** one entry per bucket that had sales; the client fills the empty ones */
  trend: { bucket: string; revenue: number; orders: number }[];
  payment_mix: { cash: number; online: number };
  top_products: {
    product_id: string;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  recent_orders: {
    id: string;
    invoice_no: string;
    customer_name: string;
    items_count: number;
    total: number;
    status: string;
    created_at: string | null;
  }[];
  low_stock: {
    id: string;
    name: string;
    sku: string;
    quantity: number;
    /** the product own reorder level, 0 when it uses the office-wide one */
    min_stock: number;
  }[];
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Sale.name)
    private readonly saleModel: Model<SaleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
  ) {}

  async overview(query: QueryDashboardDto): Promise<DashboardOverview> {
    const office = query.office_id
      ? new Types.ObjectId(query.office_id)
      : undefined;
    const tz = safeTimeZone(query.tz);

    const to = query.date_to ? new Date(query.date_to) : new Date();
    const from = query.date_from ? new Date(query.date_from) : startOfToday();
    if (from >= to) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { date_from: ['date_from must be before date_to'] },
      });
    }

    // compare against the same window shifted back by whole days: "today so
    // far" vs "yesterday up to the same time", "last 7 days" vs the 7 before
    const span = to.getTime() - from.getTime();
    const shift = Math.ceil(span / DAY_MS) * DAY_MS;
    const prevFrom = new Date(from.getTime() - shift);
    const prevTo = new Date(to.getTime() - shift);
    const granularity: Granularity = span <= HOURLY_LIMIT_MS ? 'hour' : 'day';

    const scope: Record<string, any> = { deleted_at: null };
    if (office) scope.office_id = office;

    const [
      current,
      previous,
      newCustomers,
      prevCustomers,
      outstanding,
      trend,
      paymentMix,
      topProducts,
      recentOrders,
      lowStock,
      purchases,
      prevPurchases,
      payable,
    ] = await Promise.all([
      this.periodTotals(scope, from, to),
      this.periodTotals(scope, prevFrom, prevTo),
      this.countNewCustomers(scope, from, to),
      this.countNewCustomers(scope, prevFrom, prevTo),
      this.outstandingBorrow(scope),
      this.trend(scope, from, to, granularity, tz),
      this.paymentMix(scope, from, to),
      this.topProducts(scope, from, to),
      this.recentOrders(scope, from, to),
      this.lowStock(scope, query.low_stock),
      this.purchaseTotal(scope, from, to),
      this.purchaseTotal(scope, prevFrom, prevTo),
      this.outstandingPayable(scope),
    ]);

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
        tz,
      },
      kpis: {
        revenue: { value: current.revenue, previous: previous.revenue },
        orders: { value: current.orders, previous: previous.orders },
        new_customers: { value: newCustomers, previous: prevCustomers },
        refunds: { value: current.refunds, previous: previous.refunds },
        outstanding_borrow: outstanding,
        purchases: { value: purchases, previous: prevPurchases },
        outstanding_payable: payable,
      },
      trend,
      payment_mix: paymentMix,
      top_products: topProducts,
      recent_orders: recentOrders,
      low_stock: lowStock,
    };
  }

  // ---------- pieces ----------

  /** Revenue and orders exclude refunded sales; refunds are their own figure. */
  private async periodTotals(
    scope: Record<string, any>,
    from: Date,
    to: Date,
  ): Promise<{ revenue: number; orders: number; refunds: number }> {
    const [row] = await this.saleModel
      .aggregate<{ revenue: number; orders: number; refunds: number }>([
        { $match: { ...scope, created_at: { $gte: from, $lt: to } } },
        {
          $group: {
            _id: null,
            revenue: {
              $sum: {
                $cond: [{ $ne: ['$status', SaleStatus.REFUNDED] }, '$total', 0],
              },
            },
            orders: {
              $sum: {
                $cond: [{ $ne: ['$status', SaleStatus.REFUNDED] }, 1, 0],
              },
            },
            refunds: {
              $sum: {
                $cond: [{ $eq: ['$status', SaleStatus.REFUNDED] }, '$total', 0],
              },
            },
          },
        },
      ])
      .exec();
    return {
      revenue: round2(row?.revenue ?? 0),
      orders: row?.orders ?? 0,
      refunds: round2(row?.refunds ?? 0),
    };
  }

  private countNewCustomers(
    scope: Record<string, any>,
    from: Date,
    to: Date,
  ): Promise<number> {
    return this.customerModel
      .countDocuments({ ...scope, created_at: { $gte: from, $lt: to } })
      .exec();
  }

  private async outstandingBorrow(scope: Record<string, any>): Promise<number> {
    const [row] = await this.customerModel
      .aggregate<{ total: number }>([
        { $match: { ...scope, borrow_amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$borrow_amount' } } },
      ])
      .exec();
    return round2(row?.total ?? 0);
  }

  /** What the stock bought in during the period cost. */
  private async purchaseTotal(
    scope: Record<string, any>,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [row] = await this.purchaseModel
      .aggregate<{ total: number }>([
        {
          $match: {
            ...scope,
            // ordered bills have not landed yet; cancelled ones never will
            status: { $in: ACTIVE_PURCHASE_STATUSES },
            created_at: { $gte: from, $lte: to },
          },
        },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ])
      .exec();
    return round2(row?.total ?? 0);
  }

  /** The mirror of the customers' borrow: what the office owes suppliers. */
  private async outstandingPayable(scope: Record<string, any>): Promise<number> {
    const [row] = await this.supplierModel
      .aggregate<{ total: number }>([
        { $match: { ...scope, payable_amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$payable_amount' } } },
      ])
      .exec();
    return round2(row?.total ?? 0);
  }

  /** Takings per hour/day, bucketed in the viewer's timezone. */
  private async trend(
    scope: Record<string, any>,
    from: Date,
    to: Date,
    granularity: Granularity,
    tz: string,
  ): Promise<DashboardOverview['trend']> {
    const format = granularity === 'hour' ? '%Y-%m-%d %H' : '%Y-%m-%d';
    const rows = await this.saleModel
      .aggregate<{ _id: string; revenue: number; orders: number }>([
        {
          $match: {
            ...scope,
            status: { $ne: SaleStatus.REFUNDED },
            created_at: { $gte: from, $lt: to },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format, date: '$created_at', timezone: tz },
            },
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    return rows.map((r) => ({
      bucket: r._id,
      revenue: round2(r.revenue),
      orders: r.orders,
    }));
  }

  private async paymentMix(
    scope: Record<string, any>,
    from: Date,
    to: Date,
  ): Promise<{ cash: number; online: number }> {
    const rows = await this.saleModel
      .aggregate<{ _id: string; total: number }>([
        {
          $match: {
            ...scope,
            status: { $ne: SaleStatus.REFUNDED },
            created_at: { $gte: from, $lt: to },
          },
        },
        { $group: { _id: '$payment_method', total: { $sum: '$total' } } },
      ])
      .exec();
    const by = new Map(rows.map((r) => [r._id, r.total]));
    return {
      cash: round2(by.get(PaymentMethod.CASH) ?? 0),
      online: round2(by.get(PaymentMethod.ONLINE) ?? 0),
    };
  }

  /** Best sellers by revenue, from the line snapshots of the period's sales. */
  private async topProducts(
    scope: Record<string, any>,
    from: Date,
    to: Date,
  ): Promise<DashboardOverview['top_products']> {
    const rows = await this.saleModel
      .aggregate<{
        _id: Types.ObjectId;
        name: string;
        quantity: number;
        revenue: number;
      }>([
        {
          $match: {
            ...scope,
            status: { $ne: SaleStatus.REFUNDED },
            created_at: { $gte: from, $lt: to },
          },
        },
        { $sort: { created_at: 1 } },
        { $unwind: '$lines' },
        {
          $group: {
            _id: '$lines.product_id',
            // latest snapshot wins if the product was renamed mid-period
            name: { $last: '$lines.name' },
            quantity: { $sum: '$lines.quantity' },
            revenue: { $sum: '$lines.total' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ])
      .exec();
    return rows.map((r) => ({
      product_id: r._id.toString(),
      name: r.name,
      quantity: r.quantity,
      revenue: round2(r.revenue),
    }));
  }

  private async recentOrders(
    scope: Record<string, any>,
    from: Date,
    to: Date,
  ): Promise<DashboardOverview['recent_orders']> {
    const docs = await this.saleModel
      .find({ ...scope, created_at: { $gte: from, $lt: to } })
      .select('invoice_no customer_name items_count total status created_at')
      .sort({ created_at: -1 })
      .limit(6)
      .exec();
    return docs.map((d) => {
      const json = d.toJSON() as { created_at?: string };
      return {
        id: d._id.toString(),
        invoice_no: d.invoice_no,
        customer_name: d.customer_name,
        items_count: d.items_count,
        total: d.total,
        status: d.status,
        created_at: json.created_at ?? null,
      };
    });
  }

  /** Current state, not a period figure: active products running out. */
  private async lowStock(
    scope: Record<string, any>,
    threshold: number,
  ): Promise<DashboardOverview['low_stock']> {
    // a product's own reorder level wins; 0 means "use the office-wide mark"
    const docs = await this.productModel
      .aggregate<{
        _id: Types.ObjectId;
        name: string;
        sku: string;
        quantity: number;
        min_stock: number;
      }>([
        { $match: { ...scope, status: ProductStatus.ACTIVE } },
        {
          $addFields: {
            reorder_level: {
              $cond: [{ $gt: ['$min_stock', 0] }, '$min_stock', threshold],
            },
          },
        },
        { $match: { $expr: { $lte: ['$quantity', '$reorder_level'] } } },
        { $sort: { quantity: 1, name: 1 } },
        { $limit: 8 },
        { $project: { name: 1, sku: 1, quantity: 1, min_stock: 1 } },
      ])
      .exec();
    return docs.map((d) => ({
      id: String(d._id),
      name: d.name,
      sku: d.sku,
      quantity: d.quantity,
      min_stock: d.min_stock ?? 0,
    }));
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Mongo throws on an unknown zone — fall back to UTC instead of a 500. */
function safeTimeZone(tz?: string): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
