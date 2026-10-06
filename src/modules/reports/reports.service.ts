import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  CustomerPayment,
  CustomerPaymentDocument,
} from '../customers/schemas/customer-payment.schema';
import {
  Customer,
  CustomerDocument,
} from '../customers/schemas/customer.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { ACTIVE_PURCHASE_STATUSES } from '../purchases/schemas/purchase.schema';
import { Sale, SaleDocument, SaleStatus } from '../sales/schemas/sale.schema';
import { Supplier, SupplierDocument } from '../suppliers/schemas/supplier.schema';
import {
  BaseReportDto,
  SalesReportDto,
  SortOrder,
  StockReportDto,
} from './dto/query-report.dto';

/** Every report answers with the same envelope: a page of rows + totals. */
export interface ReportPage<TRow, TSummary> {
  data: TRow[];
  total: number;
  page: number;
  limit: number;
  summary: TSummary;
}

export interface SalesReportRow {
  id: string;
  invoice_no: string;
  created_at: string | null;
  customer_name: string;
  items_count: number;
  payment_method: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid_amount: number;
  borrow_amount: number;
}

export interface SalesReportSummary {
  orders: number;
  gross: number;
  discount: number;
  net: number;
  paid: number;
  borrow: number;
  average_order: number;
  refunded: number;
}

export interface ProductReportRow {
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
  orders: number;
  average_price: number;
  /** units sold x the product's latest landed cost */
  cost: number;
  /** revenue - cost */
  profit: number;
  /** profit as a share of revenue, 0-100 */
  margin: number;
}

export interface ProductReportSummary {
  products: number;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

export interface StockReportRow {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  price: number;
  stock_value: number;
  status: string;
  location_code: string | null;
}

export interface StockReportSummary {
  products: number;
  units: number;
  stock_value: number;
  low_stock: number;
  out_of_stock: number;
}

export interface ReceivableRow {
  id: string;
  name: string;
  mobile_no: string;
  borrow_amount: number;
  borrowed_in_period: number;
  paid_in_period: number;
}

export interface ReceivableSummary {
  customers: number;
  outstanding: number;
  borrowed_in_period: number;
  paid_in_period: number;
}

export interface PayableRow {
  id: string;
  name: string;
  company: string;
  mobile_no: string;
  payable_amount: number;
  purchased_in_period: number;
  paid_in_period: number;
}

export interface PayableSummary {
  suppliers: number;
  outstanding: number;
  purchased_in_period: number;
  paid_in_period: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Sale.name)
    private readonly saleModel: Model<SaleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(CustomerPayment.name)
    private readonly paymentModel: Model<CustomerPaymentDocument>,
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
  ) {}

  // ---------- 1. sales ----------

  /** Every bill in the period, with the money split across the summary. */
  async sales(
    query: SalesReportDto,
  ): Promise<ReportPage<SalesReportRow, SalesReportSummary>> {
    const { page, limit } = query;
    const match = this.saleMatch(query);
    const sortSpec = this.sortSpec(query, 'created_at', [
      'invoice_no',
      'customer_name',
      'items_count',
      'total',
      'paid_amount',
      'borrow_amount',
      'status',
      'created_at',
    ]);

    const [rows, total, summary] = await Promise.all([
      this.saleModel
        .find(match)
        .select(
          'invoice_no customer_name items_count payment_method status subtotal discount total paid_amount borrow_amount created_at',
        )
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.saleModel.countDocuments(match).exec(),
      this.salesSummary(match),
    ]);

    const data: SalesReportRow[] = rows.map((d) => {
      const json = d.toJSON() as { created_at?: string };
      return {
        id: d._id.toString(),
        invoice_no: d.invoice_no,
        created_at: json.created_at ?? null,
        customer_name: d.customer_name,
        items_count: d.items_count,
        payment_method: d.payment_method,
        status: d.status,
        subtotal: d.subtotal,
        discount: d.discount,
        total: d.total,
        paid_amount: d.paid_amount ?? d.total,
        borrow_amount: d.borrow_amount ?? 0,
      };
    });

    return { data, total, page, limit, summary };
  }

  private async salesSummary(
    match: Record<string, any>,
  ): Promise<SalesReportSummary> {
    const live = { $ne: ['$status', SaleStatus.REFUNDED] };
    const [row] = await this.saleModel
      .aggregate<{
        orders: number;
        gross: number;
        discount: number;
        net: number;
        paid: number;
        borrow: number;
        refunded: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            // refunds are listed but never counted as takings
            orders: { $sum: { $cond: [live, 1, 0] } },
            gross: { $sum: { $cond: [live, '$subtotal', 0] } },
            discount: { $sum: { $cond: [live, '$discount', 0] } },
            net: { $sum: { $cond: [live, '$total', 0] } },
            paid: {
              $sum: {
                $cond: [live, { $ifNull: ['$paid_amount', '$total'] }, 0],
              },
            },
            borrow: {
              $sum: { $cond: [live, { $ifNull: ['$borrow_amount', 0] }, 0] },
            },
            refunded: {
              $sum: {
                $cond: [{ $eq: ['$status', SaleStatus.REFUNDED] }, '$total', 0],
              },
            },
          },
        },
      ])
      .exec();

    const orders = row?.orders ?? 0;
    const net = round2(row?.net ?? 0);
    return {
      orders,
      gross: round2(row?.gross ?? 0),
      discount: round2(row?.discount ?? 0),
      net,
      paid: round2(row?.paid ?? 0),
      borrow: round2(row?.borrow ?? 0),
      refunded: round2(row?.refunded ?? 0),
      average_order: orders ? round2(net / orders) : 0,
    };
  }

  // ---------- 2. item-wise sales ----------

  /** What actually sold, rolled up from the line snapshots. */
  async products(
    query: BaseReportDto,
  ): Promise<ReportPage<ProductReportRow, ProductReportSummary>> {
    const { page, limit } = query;
    // the search here means the product, not the bill: it is applied to the
    // rolled-up lines below, never to the sales that feed them
    const match = this.saleMatch(query, { excludeRefunded: true, skipSearch: true });
    const sortField =
      query.sort &&
      ['name', 'quantity', 'revenue', 'orders', 'cost', 'profit'].includes(query.sort)
        ? query.sort
        : 'revenue';
    const dir = query.order === SortOrder.ASC ? 1 : -1;

    const rollup: PipelineStage[] = [
      { $match: match },
      { $sort: { created_at: 1 } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.product_id',
          name: { $last: '$lines.name' },
          sku: { $last: '$lines.sku' },
          quantity: { $sum: '$lines.quantity' },
          revenue: { $sum: '$lines.total' },
          orders: { $addToSet: '$_id' },
        },
      },
      {
        // margin is costed at the product's latest landed cost, not at the
        // cost of the exact batch sold — sale lines never stored a cost.
        $lookup: {
          from: 'products',
          let: { pid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
            { $project: { cost_price: 1 } },
          ],
          as: 'product',
        },
      },
      {
        $addFields: {
          cost: {
            $multiply: [
              '$quantity',
              { $ifNull: [{ $first: '$product.cost_price' }, 0] },
            ],
          },
        },
      },
      {
        $project: {
          name: 1,
          sku: 1,
          quantity: 1,
          revenue: 1,
          cost: 1,
          profit: { $subtract: ['$revenue', '$cost'] },
          orders: { $size: '$orders' },
        },
      },
    ];

    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      rollup.push({ $match: { $or: [{ name: rx }, { sku: rx }] } });
    }

    const [result] = await this.saleModel
      .aggregate<{
        rows: (ProductReportRow & { _id: Types.ObjectId })[];
        meta: {
          products: number;
          quantity: number;
          revenue: number;
          cost: number;
          profit: number;
        }[];
      }>([
        ...rollup,
        {
          $facet: {
            rows: [
              { $sort: { [sortField]: dir } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            meta: [
              {
                $group: {
                  _id: null,
                  products: { $sum: 1 },
                  quantity: { $sum: '$quantity' },
                  revenue: { $sum: '$revenue' },
                  cost: { $sum: '$cost' },
                  profit: { $sum: '$profit' },
                },
              },
            ],
          },
        },
      ])
      .exec();

    const meta = result?.meta?.[0];
    const data: ProductReportRow[] = (result?.rows ?? []).map((r) => ({
      product_id: r._id?.toString() ?? '',
      name: r.name,
      sku: r.sku,
      quantity: r.quantity,
      revenue: round2(r.revenue),
      orders: r.orders,
      average_price: r.quantity ? round2(r.revenue / r.quantity) : 0,
      cost: round2(r.cost ?? 0),
      profit: round2(r.profit ?? 0),
      margin: r.revenue ? round2(((r.profit ?? 0) / r.revenue) * 100) : 0,
    }));

    const revenue = round2(meta?.revenue ?? 0);
    const profit = round2(meta?.profit ?? 0);

    return {
      data,
      total: meta?.products ?? 0,
      page,
      limit,
      summary: {
        products: meta?.products ?? 0,
        quantity: meta?.quantity ?? 0,
        revenue,
        cost: round2(meta?.cost ?? 0),
        profit,
        margin: revenue ? round2((profit / revenue) * 100) : 0,
      },
    };
  }

  // ---------- 3. stock on hand ----------

  /** Current inventory and what it is worth — a snapshot, not a period. */
  async stock(
    query: StockReportDto,
  ): Promise<ReportPage<StockReportRow, StockReportSummary>> {
    const { page, limit, low_stock } = query;

    const match: Record<string, any> = { deleted_at: null };
    if (query.office_id) {
      match.office_id = new Types.ObjectId(query.office_id);
    }
    if (query.status) {
      match.status = query.status;
    }
    if (query.low_only) {
      match.quantity = { $lte: low_stock };
    }
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
    }

    const sortField =
      query.sort && ['name', 'sku', 'quantity', 'price', 'stock_value'].includes(query.sort)
        ? query.sort
        : 'stock_value';
    const dir = query.order === SortOrder.ASC ? 1 : -1;

    const [result] = await this.productModel
      .aggregate<{
        rows: Record<string, any>[];
        meta: StockReportSummary[];
      }>([
        { $match: match },
        { $addFields: { stock_value: { $multiply: ['$quantity', '$price'] } } },
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
          $facet: {
            rows: [
              { $sort: { [sortField]: dir } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              {
                $project: {
                  name: 1,
                  sku: 1,
                  quantity: 1,
                  price: 1,
                  stock_value: 1,
                  status: 1,
                  location_code: '$location.location_code',
                },
              },
            ],
            meta: [
              {
                $group: {
                  _id: null,
                  products: { $sum: 1 },
                  units: { $sum: '$quantity' },
                  stock_value: { $sum: '$stock_value' },
                  low_stock: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $lte: ['$quantity', low_stock] },
                            { $gt: ['$quantity', 0] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  out_of_stock: {
                    $sum: { $cond: [{ $eq: ['$quantity', 0] }, 1, 0] },
                  },
                },
              },
            ],
          },
        },
      ])
      .exec();

    const meta = result?.meta?.[0];
    const data: StockReportRow[] = (result?.rows ?? []).map((r) => ({
      id: String(r._id),
      name: r.name,
      sku: r.sku,
      quantity: r.quantity ?? 0,
      price: r.price ?? 0,
      stock_value: round2(r.stock_value ?? 0),
      status: r.status,
      location_code: r.location_code ?? null,
    }));

    return {
      data,
      total: meta?.products ?? 0,
      page,
      limit,
      summary: {
        products: meta?.products ?? 0,
        units: meta?.units ?? 0,
        stock_value: round2(meta?.stock_value ?? 0),
        low_stock: meta?.low_stock ?? 0,
        out_of_stock: meta?.out_of_stock ?? 0,
      },
    };
  }

  // ---------- 4. receivables ----------

  /**
   * Who owes money: the current balance, plus what they borrowed and repaid
   * inside the period.
   */
  async receivables(
    query: BaseReportDto,
  ): Promise<ReportPage<ReceivableRow, ReceivableSummary>> {
    const { page, limit } = query;
    const office = query.office_id
      ? new Types.ObjectId(query.office_id)
      : undefined;
    const range = this.dateRange(query.date_from, query.date_to);

    const match: Record<string, any> = { deleted_at: null };
    if (office) match.office_id = office;
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ first_name: rx }, { last_name: rx }, { mobile_no: rx }];
    }

    const periodFilter = range ? [{ $match: { created_at: range } }] : [];
    const sortField =
      query.sort && ['name', 'borrow_amount', 'paid_in_period', 'borrowed_in_period'].includes(query.sort)
        ? query.sort
        : 'borrow_amount';
    const dir = query.order === SortOrder.ASC ? 1 : -1;

    const [result] = await this.customerModel
      .aggregate<{ rows: Record<string, any>[]; meta: Record<string, number>[] }>([
        { $match: match },
        {
          // what this customer borrowed on bills inside the period
          $lookup: {
            from: 'sales',
            let: { cid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$customer_id', '$$cid'] },
                  deleted_at: null,
                  status: { $ne: SaleStatus.REFUNDED },
                },
              },
              ...periodFilter,
              {
                $group: {
                  _id: null,
                  amount: { $sum: { $ifNull: ['$borrow_amount', 0] } },
                },
              },
            ],
            as: 'borrowed',
          },
        },
        {
          // and what they repaid inside the period
          $lookup: {
            from: 'customer_payments',
            let: { cid: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$customer_id', '$$cid'] } } },
              ...periodFilter,
              { $group: { _id: null, amount: { $sum: '$amount' } } },
            ],
            as: 'repaid',
          },
        },
        {
          $addFields: {
            name: { $trim: { input: { $concat: ['$first_name', ' ', '$last_name'] } } },
            borrow_amount: { $ifNull: ['$borrow_amount', 0] },
            borrowed_in_period: {
              $ifNull: [{ $first: '$borrowed.amount' }, 0],
            },
            paid_in_period: { $ifNull: [{ $first: '$repaid.amount' }, 0] },
          },
        },
        {
          // only customers the report has something to say about
          $match: {
            $or: [
              { borrow_amount: { $gt: 0 } },
              { borrowed_in_period: { $gt: 0 } },
              { paid_in_period: { $gt: 0 } },
            ],
          },
        },
        {
          $facet: {
            rows: [
              { $sort: { [sortField]: dir } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              {
                $project: {
                  name: 1,
                  mobile_no: 1,
                  borrow_amount: 1,
                  borrowed_in_period: 1,
                  paid_in_period: 1,
                },
              },
            ],
            meta: [
              {
                $group: {
                  _id: null,
                  customers: { $sum: 1 },
                  outstanding: { $sum: '$borrow_amount' },
                  borrowed_in_period: { $sum: '$borrowed_in_period' },
                  paid_in_period: { $sum: '$paid_in_period' },
                },
              },
            ],
          },
        },
      ])
      .exec();

    const meta = result?.meta?.[0];
    const data: ReceivableRow[] = (result?.rows ?? []).map((r) => ({
      id: String(r._id),
      name: r.name,
      mobile_no: r.mobile_no,
      borrow_amount: round2(r.borrow_amount ?? 0),
      borrowed_in_period: round2(r.borrowed_in_period ?? 0),
      paid_in_period: round2(r.paid_in_period ?? 0),
    }));

    return {
      data,
      total: meta?.customers ?? 0,
      page,
      limit,
      summary: {
        customers: meta?.customers ?? 0,
        outstanding: round2(meta?.outstanding ?? 0),
        borrowed_in_period: round2(meta?.borrowed_in_period ?? 0),
        paid_in_period: round2(meta?.paid_in_period ?? 0),
      },
    };
  }

  // ---------- 5. payables ----------

  /**
   * The mirror of receivables: who the shop owes, what was bought from them
   * inside the period and what was paid back.
   */
  async payables(
    query: BaseReportDto,
  ): Promise<ReportPage<PayableRow, PayableSummary>> {
    const { page, limit } = query;
    const office = query.office_id
      ? new Types.ObjectId(query.office_id)
      : undefined;
    const range = this.dateRange(query.date_from, query.date_to);

    const match: Record<string, any> = { deleted_at: null };
    if (office) match.office_id = office;
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ name: rx }, { company: rx }, { mobile_no: rx }];
    }

    const periodFilter = range ? [{ $match: { created_at: range } }] : [];
    const sortField =
      query.sort &&
      ['name', 'payable_amount', 'paid_in_period', 'purchased_in_period'].includes(
        query.sort,
      )
        ? query.sort
        : 'payable_amount';
    const dir = query.order === SortOrder.ASC ? 1 : -1;

    const [result] = await this.supplierModel
      .aggregate<{ rows: Record<string, any>[]; meta: Record<string, number>[] }>([
        { $match: match },
        {
          // bills raised against this supplier inside the period
          $lookup: {
            from: 'purchases',
            let: { sid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$supplier_id', '$$sid'] },
                  deleted_at: null,
                  status: { $in: ACTIVE_PURCHASE_STATUSES },
                },
              },
              ...periodFilter,
              { $group: { _id: null, amount: { $sum: { $ifNull: ['$total', 0] } } } },
            ],
            as: 'purchased',
          },
        },
        {
          // and what was paid to them inside the period
          $lookup: {
            from: 'supplier_payments',
            let: { sid: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$supplier_id', '$$sid'] } } },
              ...periodFilter,
              { $group: { _id: null, amount: { $sum: '$amount' } } },
            ],
            as: 'settled',
          },
        },
        {
          $addFields: {
            payable_amount: { $ifNull: ['$payable_amount', 0] },
            purchased_in_period: { $ifNull: [{ $first: '$purchased.amount' }, 0] },
            paid_in_period: { $ifNull: [{ $first: '$settled.amount' }, 0] },
          },
        },
        {
          // only suppliers the report has something to say about
          $match: {
            $or: [
              { payable_amount: { $gt: 0 } },
              { purchased_in_period: { $gt: 0 } },
              { paid_in_period: { $gt: 0 } },
            ],
          },
        },
        {
          $facet: {
            rows: [
              { $sort: { [sortField]: dir } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              {
                $project: {
                  name: 1,
                  company: 1,
                  mobile_no: 1,
                  payable_amount: 1,
                  purchased_in_period: 1,
                  paid_in_period: 1,
                },
              },
            ],
            meta: [
              {
                $group: {
                  _id: null,
                  suppliers: { $sum: 1 },
                  outstanding: { $sum: '$payable_amount' },
                  purchased_in_period: { $sum: '$purchased_in_period' },
                  paid_in_period: { $sum: '$paid_in_period' },
                },
              },
            ],
          },
        },
      ])
      .exec();

    const meta = result?.meta?.[0];
    const data: PayableRow[] = (result?.rows ?? []).map((r) => ({
      id: String(r._id),
      name: r.name,
      company: r.company ?? '',
      mobile_no: r.mobile_no,
      payable_amount: round2(r.payable_amount ?? 0),
      purchased_in_period: round2(r.purchased_in_period ?? 0),
      paid_in_period: round2(r.paid_in_period ?? 0),
    }));

    return {
      data,
      total: meta?.suppliers ?? 0,
      page,
      limit,
      summary: {
        suppliers: meta?.suppliers ?? 0,
        outstanding: round2(meta?.outstanding ?? 0),
        purchased_in_period: round2(meta?.purchased_in_period ?? 0),
        paid_in_period: round2(meta?.paid_in_period ?? 0),
      },
    };
  }

  // ---------- helpers ----------

  private saleMatch(
    query: SalesReportDto | BaseReportDto,
    opts: { excludeRefunded?: boolean; skipSearch?: boolean } = {},
  ): Record<string, any> {
    const q = query as SalesReportDto;
    const match: Record<string, any> = { deleted_at: null };
    if (query.office_id) {
      match.office_id = new Types.ObjectId(query.office_id);
    }
    if (opts.excludeRefunded) {
      match.status = { $ne: SaleStatus.REFUNDED };
    } else if (q.status) {
      match.status = q.status;
    }
    if (q.payment_method) {
      match.payment_method = q.payment_method;
    }
    if (q.borrow_only) {
      match.borrow_amount = { $gt: 0 };
    }
    const range = this.dateRange(query.date_from, query.date_to);
    if (range) {
      match.created_at = range;
    }
    if (!opts.skipSearch && query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ invoice_no: rx }, { customer_name: rx }];
    }
    return match;
  }

  private dateRange(from?: string, to?: string): Record<string, Date> | null {
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    return Object.keys(range).length ? range : null;
  }

  private sortSpec(
    query: BaseReportDto,
    fallback: string,
    allowed: string[],
  ): Record<string, 1 | -1> {
    const field = query.sort && allowed.includes(query.sort) ? query.sort : fallback;
    return { [field]: query.order === SortOrder.ASC ? 1 : -1 };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
