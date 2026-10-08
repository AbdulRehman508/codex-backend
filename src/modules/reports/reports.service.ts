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
import {
  ProductLot,
  ProductLotDocument,
} from '../purchases/schemas/product-lot.schema';
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
  StockAdjustment,
  StockAdjustmentDocument,
} from '../stock/schemas/stock-adjustment.schema';
import {
  StockTransfer,
  StockTransferDocument,
} from '../stock/schemas/stock-transfer.schema';
import {
  SupplierPayment,
  SupplierPaymentDocument,
} from '../suppliers/schemas/supplier-payment.schema';
import { Supplier, SupplierDocument } from '../suppliers/schemas/supplier.schema';
import {
  BaseReportDto,
  DayCloseDto,
  ExpiryReportDto,
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
  tax_amount: number;
  total: number;
  paid_amount: number;
  borrow_amount: number;
}

export interface SalesReportSummary {
  orders: number;
  gross: number;
  discount: number;
  /** sales tax charged across the period */
  tax: number;
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
  unit: string;
  quantity: number;
  /** this product's own reorder level, 0 when it uses the office-wide one */
  min_stock: number;
  price: number;
  cost_price: number;
  /** quantity x sell price */
  stock_value: number;
  /** quantity x landed cost — what the shelf is actually worth */
  cost_value: number;
  status: string;
  location_code: string | null;
}

export interface StockReportSummary {
  products: number;
  units: number;
  stock_value: number;
  /** inventory valued at cost, the figure an owner books */
  cost_value: number;
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

export interface ExpiryRow {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  batch_no: string;
  expiry_date: string | null;
  /** days left; negative once the date has passed */
  days_left: number | null;
  quantity: number;
  cost_price: number;
  cost_value: number;
  purchase_no: string;
  supplier_name: string;
  received_at: string | null;
}

export interface ExpirySummary {
  lots: number;
  units: number;
  cost_value: number;
  expired_lots: number;
  expired_units: number;
}

/** One day's close-out, the way a shopkeeper counts at closing time. */
export interface DayClose {
  date: string;
  tz: string;
  from: string;
  to: string;
  sales: {
    orders: number;
    gross: number;
    discount: number;
    tax: number;
    net: number;
    refunds: number;
    refunded: number;
  };
  payments: {
    cash: number;
    cash_orders: number;
    online: number;
    online_orders: number;
    collected: number;
    credit_given: number;
    customer_repayments: number;
    repayment_count: number;
  };
  purchases: {
    bills: number;
    total: number;
    paid: number;
    supplier_payments: number;
    payment_count: number;
  };
  stock: { adjustments: number; transfers: number };
  cash_drawer: { in: number; out: number; expected: number };
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
    @InjectModel(SupplierPayment.name)
    private readonly supplierPaymentModel: Model<SupplierPaymentDocument>,
    @InjectModel(Purchase.name)
    private readonly purchaseModel: Model<PurchaseDocument>,
    @InjectModel(StockAdjustment.name)
    private readonly adjustmentModel: Model<StockAdjustmentDocument>,
    @InjectModel(StockTransfer.name)
    private readonly transferModel: Model<StockTransferDocument>,
    @InjectModel(ProductLot.name)
    private readonly lotModel: Model<ProductLotDocument>,
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
        tax_amount: d.tax_amount ?? 0,
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
        tax: number;
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
            tax: { $sum: { $cond: [live, { $ifNull: ['$tax_amount', 0] }, 0] } },
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
      tax: round2(row?.tax ?? 0),
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
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      match.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
    }

    const sortField =
      query.sort &&
      ['name', 'sku', 'quantity', 'price', 'stock_value', 'cost_value', 'min_stock'].includes(
        query.sort,
      )
        ? query.sort
        : 'stock_value';
    const dir = query.order === SortOrder.ASC ? 1 : -1;

    // a product's own reorder level wins; 0 means "use the office-wide mark"
    const reorderLevel = {
      $cond: [{ $gt: ['$min_stock', 0] }, '$min_stock', low_stock],
    };
    const isLow = { $lte: ['$quantity', reorderLevel] };

    const [result] = await this.productModel
      .aggregate<{
        rows: Record<string, any>[];
        meta: StockReportSummary[];
      }>([
        { $match: match },
        {
          $addFields: {
            min_stock: { $ifNull: ['$min_stock', 0] },
            cost_price: { $ifNull: ['$cost_price', 0] },
            unit: { $ifNull: ['$unit', 'pcs'] },
            stock_value: { $multiply: ['$quantity', '$price'] },
            cost_value: {
              $multiply: ['$quantity', { $ifNull: ['$cost_price', 0] }],
            },
          },
        },
        // "low stock only" is per product, so it filters after the level is known
        ...(query.low_only ? [{ $match: { $expr: isLow } }] : []),
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
                  unit: 1,
                  quantity: 1,
                  min_stock: 1,
                  price: 1,
                  cost_price: 1,
                  stock_value: 1,
                  cost_value: 1,
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
                  cost_value: { $sum: '$cost_value' },
                  low_stock: {
                    $sum: {
                      $cond: [
                        { $and: [isLow, { $gt: ['$quantity', 0] }] },
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
      unit: r.unit ?? 'pcs',
      quantity: r.quantity ?? 0,
      min_stock: r.min_stock ?? 0,
      price: r.price ?? 0,
      cost_price: round2(r.cost_price ?? 0),
      stock_value: round2(r.stock_value ?? 0),
      cost_value: round2(r.cost_value ?? 0),
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
        cost_value: round2(meta?.cost_value ?? 0),
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

  // ---------- 6. expiry ----------

  /**
   * Lots running out of date. The register records what was received on each
   * batch, so these are the quantities that came in — the shelf count lives
   * on the product. Write off what has actually gone off with a stock
   * adjustment (reason "expired").
   */
  async expiry(
    query: ExpiryReportDto,
  ): Promise<ReportPage<ExpiryRow, ExpirySummary>> {
    const { page, limit } = query;
    const now = new Date();
    const horizon = new Date(
      now.getTime() + (query.within_days ?? 30) * 24 * 60 * 60 * 1000,
    );

    const filter: Record<string, any> = { expiry_date: { $ne: null } };
    if (query.office_id) {
      filter.office_id = new Types.ObjectId(query.office_id);
    }
    // already past it, or close enough to act on
    filter.expiry_date = query.expired_only
      ? { $ne: null, $lt: now }
      : { $ne: null, $lte: horizon };
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = [
        { product_name: rx },
        { sku: rx },
        { batch_no: rx },
        { supplier_name: rx },
        { purchase_no: rx },
      ];
    }

    const sortField =
      query.sort && ['expiry_date', 'product_name', 'quantity'].includes(query.sort)
        ? query.sort
        : 'expiry_date';
    // soonest first: the lot that needs attention today leads the list
    const dir = query.order === SortOrder.DESC ? -1 : 1;

    const [docs, total, meta] = await Promise.all([
      this.lotModel
        .find(filter)
        .sort({ [sortField]: dir })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.lotModel.countDocuments(filter).exec(),
      this.lotModel
        .aggregate<{
          units: number;
          cost_value: number;
          expired_lots: number;
          expired_units: number;
        }>([
          { $match: filter },
          {
            $group: {
              _id: null,
              units: { $sum: '$quantity' },
              cost_value: {
                $sum: { $multiply: ['$quantity', { $ifNull: ['$cost_price', 0] }] },
              },
              expired_lots: {
                $sum: { $cond: [{ $lt: ['$expiry_date', now] }, 1, 0] },
              },
              expired_units: {
                $sum: { $cond: [{ $lt: ['$expiry_date', now] }, '$quantity', 0] },
              },
            },
          },
        ])
        .exec(),
    ]);

    const day = 24 * 60 * 60 * 1000;
    const data: ExpiryRow[] = docs.map((d: Record<string, any>) => {
      const expiry = d.expiry_date ? new Date(d.expiry_date) : null;
      return {
        id: String(d._id),
        product_id: String(d.product_id),
        product_name: d.product_name,
        sku: d.sku ?? '',
        batch_no: d.batch_no ?? '',
        expiry_date: expiry ? expiry.toISOString() : null,
        days_left: expiry
          ? Math.floor((expiry.getTime() - now.getTime()) / day)
          : null,
        quantity: d.quantity ?? 0,
        cost_price: round2(d.cost_price ?? 0),
        cost_value: round2((d.quantity ?? 0) * (d.cost_price ?? 0)),
        purchase_no: d.purchase_no ?? '',
        supplier_name: d.supplier_name ?? '',
        received_at: d.created_at ? new Date(d.created_at).toISOString() : null,
      };
    });

    const m = meta[0];
    return {
      data,
      total,
      page,
      limit,
      summary: {
        lots: total,
        units: m?.units ?? 0,
        cost_value: round2(m?.cost_value ?? 0),
        expired_lots: m?.expired_lots ?? 0,
        expired_units: m?.expired_units ?? 0,
      },
    };
  }

  // ---------- 7. day close ----------

  /**
   * What one day came to, the way a shopkeeper counts it at closing time:
   * what was sold, what was actually collected, what went out, and the cash
   * that should be in the drawer. The day is measured in the viewer's own
   * timezone — a sale at 11pm belongs to that day, not to UTC's next one.
   */
  async dayClose(query: DayCloseDto): Promise<DayClose> {
    const tz = safeTimeZone(query.tz);
    const { from, to, label } = dayBounds(query.date, tz);
    const office = query.office_id
      ? new Types.ObjectId(query.office_id)
      : undefined;

    const scope: Record<string, any> = { deleted_at: null };
    if (office) scope.office_id = office;
    const inDay = { created_at: { $gte: from, $lte: to } };

    const [sales, payMix, received, supplierPaid, purchases, moves] =
      await Promise.all([
        // bills written today, refunds kept apart from the takings
        this.saleModel
          .aggregate<{
            orders: number;
            gross: number;
            discount: number;
            tax: number;
            net: number;
            collected: number;
            credit: number;
            refunded: number;
            refunds: number;
          }>([
            { $match: { ...scope, ...inDay } },
            {
              $group: {
                _id: null,
                orders: {
                  $sum: { $cond: [{ $ne: ['$status', SaleStatus.REFUNDED] }, 1, 0] },
                },
                gross: {
                  $sum: {
                    $cond: [{ $ne: ['$status', SaleStatus.REFUNDED] }, '$subtotal', 0],
                  },
                },
                discount: {
                  $sum: {
                    $cond: [{ $ne: ['$status', SaleStatus.REFUNDED] }, '$discount', 0],
                  },
                },
                tax: {
                  $sum: {
                    $cond: [
                      { $ne: ['$status', SaleStatus.REFUNDED] },
                      { $ifNull: ['$tax_amount', 0] },
                      0,
                    ],
                  },
                },
                net: {
                  $sum: {
                    $cond: [{ $ne: ['$status', SaleStatus.REFUNDED] }, '$total', 0],
                  },
                },
                collected: {
                  $sum: {
                    $cond: [
                      { $ne: ['$status', SaleStatus.REFUNDED] },
                      { $ifNull: ['$paid_amount', '$total'] },
                      0,
                    ],
                  },
                },
                credit: {
                  $sum: {
                    $cond: [
                      { $ne: ['$status', SaleStatus.REFUNDED] },
                      { $ifNull: ['$borrow_amount', 0] },
                      0,
                    ],
                  },
                },
                refunded: {
                  $sum: {
                    $cond: [{ $eq: ['$status', SaleStatus.REFUNDED] }, '$total', 0],
                  },
                },
                refunds: {
                  $sum: { $cond: [{ $eq: ['$status', SaleStatus.REFUNDED] }, 1, 0] },
                },
              },
            },
          ])
          .exec(),

        // split the takings by how they were paid
        this.saleModel
          .aggregate<{ _id: string; amount: number; orders: number }>([
            {
              $match: {
                ...scope,
                ...inDay,
                status: { $ne: SaleStatus.REFUNDED },
              },
            },
            {
              $group: {
                _id: '$payment_method',
                amount: { $sum: { $ifNull: ['$paid_amount', '$total'] } },
                orders: { $sum: 1 },
              },
            },
          ])
          .exec(),

        // old debts settled at the counter today
        this.paymentModel
          .aggregate<{ amount: number; count: number }>([
            { $match: { ...(office ? { office_id: office } : {}), ...inDay } },
            { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          ])
          .exec(),

        // money handed to suppliers today
        this.supplierPaymentModel
          .aggregate<{ amount: number; count: number }>([
            { $match: { ...(office ? { office_id: office } : {}), ...inDay } },
            { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
          ])
          .exec(),

        // stock bought in today, and what of it was paid on the spot
        this.purchaseModel
          .aggregate<{ bills: number; total: number; paid: number }>([
            {
              $match: {
                ...scope,
                ...inDay,
                status: { $in: ACTIVE_PURCHASE_STATUSES },
              },
            },
            {
              $group: {
                _id: null,
                bills: { $sum: 1 },
                total: { $sum: '$total' },
                paid: { $sum: { $ifNull: ['$paid_amount', 0] } },
              },
            },
          ])
          .exec(),

        // corrections and branch moves, so nothing unexplained is left out
        Promise.all([
          this.adjustmentModel.countDocuments({
            ...(office ? { office_id: office } : {}),
            ...inDay,
          }),
          this.transferModel.countDocuments({
            deleted_at: null,
            ...inDay,
            ...(office
              ? { $or: [{ from_office_id: office }, { to_office_id: office }] }
              : {}),
          }),
        ]),
      ]);

    const s = sales[0];
    const cash = payMix.find((p) => p._id === PaymentMethod.CASH);
    const online = payMix.find((p) => p._id === PaymentMethod.ONLINE);
    const collectedCash = round2(cash?.amount ?? 0);
    const repaid = round2(received[0]?.amount ?? 0);
    const toSuppliers = round2(supplierPaid[0]?.amount ?? 0);
    const [adjustments, transfers] = moves;

    return {
      date: label,
      tz,
      from: from.toISOString(),
      to: to.toISOString(),
      sales: {
        orders: s?.orders ?? 0,
        gross: round2(s?.gross ?? 0),
        discount: round2(s?.discount ?? 0),
        tax: round2(s?.tax ?? 0),
        net: round2(s?.net ?? 0),
        refunds: s?.refunds ?? 0,
        refunded: round2(s?.refunded ?? 0),
      },
      payments: {
        cash: collectedCash,
        cash_orders: cash?.orders ?? 0,
        online: round2(online?.amount ?? 0),
        online_orders: online?.orders ?? 0,
        collected: round2(s?.collected ?? 0),
        credit_given: round2(s?.credit ?? 0),
        customer_repayments: repaid,
        repayment_count: received[0]?.count ?? 0,
      },
      purchases: {
        bills: purchases[0]?.bills ?? 0,
        total: round2(purchases[0]?.total ?? 0),
        paid: round2(purchases[0]?.paid ?? 0),
        supplier_payments: toSuppliers,
        payment_count: supplierPaid[0]?.count ?? 0,
      },
      stock: { adjustments, transfers },
      // the drawer: cash taken at the till plus cash debts settled, less what
      // was handed to suppliers. Online takings never touch it.
      cash_drawer: {
        in: round2(collectedCash + repaid),
        out: toSuppliers,
        expected: round2(collectedCash + repaid - toSuppliers),
      },
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Browsers send an IANA zone; anything else falls back to UTC. */
function safeTimeZone(tz?: string): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Midnight-to-midnight for one calendar day in `tz`, as UTC instants. The
 * offset is read from the zone itself, so DST and half-hour zones are right.
 */
function dayBounds(
  date: string | undefined,
  tz: string,
): { from: Date; to: Date; label: string } {
  const base = date ? new Date(`${date.slice(0, 10)}T12:00:00Z`) : new Date();
  const label = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);

  const [y, m, d] = label.split('-').map(Number);
  // guess at UTC midnight, then correct by the zone's offset that day
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(guess), tz);
  const from = new Date(guess - offset);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from, to, label };
}

/** How far `tz` runs ahead of UTC at that instant, in milliseconds. */
function zoneOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - at.getTime();
}
