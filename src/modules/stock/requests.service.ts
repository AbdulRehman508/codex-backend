import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { RealtimeService } from '../../common/realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from '../products/schemas/product.schema';
import {
  AvailableStockDto,
  CreateStockRequestDto,
  QueryStockRequestDto,
  RequestDirection,
  SortOrder,
} from './dto/stock-request.dto';
import {
  RequestLine,
  StockRequest,
  StockRequestDocument,
  StockRequestStatus,
} from './schemas/stock-request.schema';
import { TransfersService } from './transfers.service';

export interface StockRequestRow {
  id: string;
  request_no: string;
  requesting_office_id: string;
  source_office_id: string;
  requesting_office_name: string;
  source_office_name: string;
  items_count: number;
  units: number;
  status: StockRequestStatus;
  note: string;
  decline_reason: string;
  transfer_id: string | null;
  reviewed_at: string | null;
  created_at: string | null;
}

export interface StockRequestSummary {
  requests: number;
  units: number;
  /** waiting on this office to answer */
  pending_incoming: number;
  /** waiting on another office to answer us */
  pending_outgoing: number;
}

export interface AvailableProduct {
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
}

const SORTABLE = ['request_no', 'items_count', 'units', 'status', 'created_at'];

@Injectable()
export class RequestsService {
  constructor(
    @InjectModel(StockRequest.name)
    private readonly requestModel: Model<StockRequestDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    private readonly counters: CountersService,
    private readonly transfers: TransfersService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- the picker ----------

  /**
   * What the holding branch can actually spare: its own live products with
   * units on the shelf. The requester is not assigned to that office, so this
   * is deliberately narrow — name, SKU, unit and the count, nothing else.
   */
  async available(query: AvailableStockDto): Promise<AvailableProduct[]> {
    const office = await this.office(query.source_office_id, 'source_office_id');
    const filter: Record<string, any> = {
      office_id: office._id,
      deleted_at: null,
      status: ProductStatus.ACTIVE,
      quantity: { $gt: 0 },
    };
    const search = query.search?.trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { sku: rx }, { barcode: rx }];
    }

    const docs = await this.productModel
      .find(filter)
      .select('name sku unit quantity')
      .sort({ name: 1 })
      .limit(query.limit)
      .lean()
      .exec();

    return docs.map((d) => ({
      product_id: String(d._id),
      name: d.name,
      sku: d.sku ?? '',
      unit: (d as { unit?: string }).unit ?? '',
      quantity: d.quantity ?? 0,
    }));
  }

  // ---------- create ----------

  /**
   * Ask another branch for stock. Nothing moves here: the request is a
   * question, and the holding branch answers it.
   */
  async create(
    dto: CreateStockRequestDto,
    userId?: string,
  ): Promise<StockRequestDocument> {
    const requesting = await this.office(dto.office_id, 'office_id');
    const source = await this.office(dto.source_office_id, 'source_office_id');

    if (requesting._id.equals(source._id)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { source_office_id: ['pick a different branch to ask'] },
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

    const lines: RequestLine[] = [];
    let units = 0;

    for (const line of dto.lines) {
      const product = await this.productModel
        .findOne({
          _id: line.product_id,
          office_id: source._id,
          deleted_at: null,
        })
        .exec();
      if (!product) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: {
            lines: [`a product on this request is not in ${source.office_name}`],
          },
        });
      }
      // checked again at approval, where it decides whether stock moves; here
      // it only stops someone asking for what plainly is not there
      if (product.quantity < line.quantity) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: {
            lines: [
              `"${product.name}" has only ${product.quantity} in ${source.office_name}`,
            ],
          },
        });
      }

      lines.push({
        product_id: product._id,
        name: product.name,
        sku: product.sku ?? '',
        quantity: line.quantity,
        available_at_request: product.quantity,
      });
      units += line.quantity;
    }

    const doc = await this.requestModel.create({
      request_no: await this.nextRequestNo(requesting._id.toString()),
      requesting_office_id: requesting._id,
      source_office_id: source._id,
      requesting_office_name: requesting.office_name,
      source_office_name: source.office_name,
      lines,
      items_count: lines.length,
      units,
      status: StockRequestStatus.PENDING,
      note: dto.note?.trim() ?? '',
      requested_by: this.toObjectIdOrNull(userId),
    });

    await this.announce(doc, 'stock-request.created', {}, userId);
    return doc;
  }

  // ---------- read ----------

  async findAll(query: QueryStockRequestDto): Promise<{
    data: StockRequestRow[];
    total: number;
    page: number;
    limit: number;
    summary: StockRequestSummary;
  }> {
    const { page, limit, sort, order } = query;
    const filter = this.buildFilter(query);
    const sortField = SORTABLE.includes(sort) ? sort : 'created_at';
    const sortSpec: Record<string, 1 | -1> = {
      [sortField]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total, totals, pendingIn, pendingOut] = await Promise.all([
      this.requestModel
        .find(filter)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.requestModel.countDocuments(filter).exec(),
      this.requestModel
        .aggregate<{ units: number }>([
          { $match: filter },
          { $group: { _id: null, units: { $sum: '$units' } } },
        ])
        .exec(),
      // the two counts the tabs badge, independent of the filter in play
      query.office_id
        ? this.requestModel
            .countDocuments({
              source_office_id: new Types.ObjectId(query.office_id),
              status: StockRequestStatus.PENDING,
              deleted_at: null,
            })
            .exec()
        : Promise.resolve(0),
      query.office_id
        ? this.requestModel
            .countDocuments({
              requesting_office_id: new Types.ObjectId(query.office_id),
              status: StockRequestStatus.PENDING,
              deleted_at: null,
            })
            .exec()
        : Promise.resolve(0),
    ]);

    return {
      data: docs.map((d) => this.toRow(d)),
      total,
      page,
      limit,
      summary: {
        requests: total,
        units: totals[0]?.units ?? 0,
        pending_incoming: pendingIn,
        pending_outgoing: pendingOut,
      },
    };
  }

  async findOne(id: string, officeId?: string): Promise<StockRequestDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      const office = new Types.ObjectId(officeId);
      // either side of the conversation may open it
      filter.$or = [
        { requesting_office_id: office },
        { source_office_id: office },
      ];
    }
    const doc = await this.requestModel.findOne(filter).exec();
    if (!doc) throw new NotFoundException(`Stock request ${id} not found`);
    return doc;
  }

  // ---------- review ----------

  /**
   * The holding branch says yes. This is the only path that moves stock: the
   * transfer is created here, and if it fails — someone sold the units in the
   * meantime — the request stays pending so the branch can answer again.
   */
  async approve(
    id: string,
    userId?: string,
    actingOfficeId?: string,
  ): Promise<StockRequestDocument> {
    const doc = await this.findOne(id);
    this.assertReviewer(doc, actingOfficeId);
    this.assertPending(doc);

    const transfer = await this.transfers.create(
      {
        office_id: doc.source_office_id.toString(),
        to_office_id: doc.requesting_office_id.toString(),
        lines: doc.lines.map((l) => ({
          product_id: l.product_id.toString(),
          quantity: l.quantity,
        })),
        note: `${doc.request_no} — ${doc.requesting_office_name}`,
      },
      userId,
    );

    doc.status = StockRequestStatus.APPROVED;
    doc.transfer_id = transfer._id;
    doc.reviewed_by = this.toObjectIdOrNull(userId);
    doc.reviewed_at = new Date();
    doc.decline_reason = '';
    await doc.save();

    await this.announce(
      doc,
      'stock-request.approved',
      { transfer_no: transfer.transfer_no },
      userId,
    );
    return doc;
  }

  /** The holding branch says no, and has to say why. */
  async decline(
    id: string,
    reason: string,
    userId?: string,
    actingOfficeId?: string,
  ): Promise<StockRequestDocument> {
    const doc = await this.findOne(id);
    this.assertReviewer(doc, actingOfficeId);
    this.assertPending(doc);

    doc.status = StockRequestStatus.DECLINED;
    doc.decline_reason = reason.trim();
    doc.reviewed_by = this.toObjectIdOrNull(userId);
    doc.reviewed_at = new Date();
    await doc.save();

    await this.announce(
      doc,
      'stock-request.declined',
      { reason: doc.decline_reason },
      userId,
    );
    return doc;
  }

  /** The asking branch changes its mind before it has been answered. */
  async cancel(
    id: string,
    userId?: string,
    actingOfficeId?: string,
  ): Promise<StockRequestDocument> {
    const doc = await this.findOne(id);
    if (actingOfficeId && !doc.requesting_office_id.equals(actingOfficeId)) {
      throw new ForbiddenException('Only the branch that asked can cancel it');
    }
    this.assertPending(doc);

    doc.status = StockRequestStatus.CANCELLED;
    doc.reviewed_by = this.toObjectIdOrNull(userId);
    doc.reviewed_at = new Date();
    await doc.save();

    await this.announce(doc, 'stock-request.cancelled', {}, userId);
    return doc;
  }

  // ---------- helpers ----------

  /**
   * Both branches hear about every answer, so neither has to refresh — and
   * the branch that has to do something about it also gets a notification it
   * can come back to, because the live nudge only reaches a screen that is
   * open at that moment.
   */
  private async announce(
    doc: StockRequestDocument,
    type: string,
    extra: Record<string, unknown> = {},
    userId?: string,
  ) {
    this.realtime.publish(
      [doc.requesting_office_id.toString(), doc.source_office_id.toString()],
      {
        type,
        payload: {
          id: doc._id.toString(),
          request_no: doc.request_no,
          status: doc.status,
          requesting_office_id: doc.requesting_office_id.toString(),
          requesting_office_name: doc.requesting_office_name,
          source_office_id: doc.source_office_id.toString(),
          source_office_name: doc.source_office_name,
          ...extra,
        },
      },
    );

    await this.notify(doc, type, extra, userId);
  }

  /**
   * Who needs to know, and what it says.
   *
   * A request goes to the branch that has to answer it; an answer goes back
   * to the branch that asked. Nobody is told about their own action — the
   * screen that did it already knows.
   *
   * A failure here must not fail the request: the stock has already moved and
   * the live event has already gone out, so a bell that missed one line is
   * the smaller loss.
   */
  private async notify(
    doc: StockRequestDocument,
    type: string,
    extra: Record<string, unknown>,
    userId?: string,
  ) {
    const asked = doc.requesting_office_id.toString();
    const holds = doc.source_office_id.toString();

    const plan: Record<
      string,
      { to: string; key: string; side: 'incoming' | 'outgoing'; office: string } | undefined
    > = {
      'stock-request.created': {
        to: holds,
        key: 'notif.requestCreated',
        side: 'incoming',
        office: doc.requesting_office_name,
      },
      'stock-request.approved': {
        to: asked,
        key: 'notif.requestApproved',
        side: 'outgoing',
        office: doc.source_office_name,
      },
      'stock-request.declined': {
        to: asked,
        key: 'notif.requestDeclined',
        side: 'outgoing',
        office: doc.source_office_name,
      },
      'stock-request.cancelled': {
        to: holds,
        key: 'notif.requestCancelled',
        side: 'incoming',
        office: doc.requesting_office_name,
      },
    };

    const step = plan[type];
    if (!step) return;

    try {
      await this.notifications.push({
        officeIds: [step.to],
        type,
        title_key: step.key,
        params: {
          request_no: doc.request_no,
          office: step.office,
          units: String(doc.units),
          items: String(doc.items_count),
          reason: String(extra['reason'] ?? doc.decline_reason ?? ''),
        },
        link: '/stock/requests',
        link_params: { id: doc._id.toString(), side: step.side },
        refId: doc._id,
        userId: userId ?? null,
      });
    } catch {
      // the request itself stands; the bell simply missed this one
    }
  }

  private assertReviewer(doc: StockRequestDocument, actingOfficeId?: string) {
    if (actingOfficeId && !doc.source_office_id.equals(actingOfficeId)) {
      throw new ForbiddenException(
        'Only the branch that was asked can answer this request',
      );
    }
  }

  private assertPending(doc: StockRequestDocument) {
    if (doc.status !== StockRequestStatus.PENDING) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { status: [`this request is already ${doc.status}`] },
      });
    }
  }

  private buildFilter(query: QueryStockRequestDto): Record<string, any> {
    const filter: Record<string, any> = { deleted_at: null };

    if (query.office_id) {
      const office = new Types.ObjectId(query.office_id);
      if (query.direction === RequestDirection.OUTGOING) {
        filter.requesting_office_id = office;
      } else if (query.direction === RequestDirection.INCOMING) {
        filter.source_office_id = office;
      } else {
        filter.$or = [
          { requesting_office_id: office },
          { source_office_id: office },
        ];
      }
    }

    if (query.status) filter.status = query.status;

    const search = query.search?.trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      const match = [
        { request_no: rx },
        { requesting_office_name: rx },
        { source_office_name: rx },
        { 'lines.name': rx },
        { 'lines.sku': rx },
      ];
      // keep an office filter that already used $or
      filter.$and = [...(filter.$and ?? []), { $or: match }];
      if (filter.$or) {
        filter.$and.push({ $or: filter.$or });
        delete filter.$or;
      }
    }

    return filter;
  }

  private toRow(doc: StockRequestDocument): StockRequestRow {
    const json = doc.toJSON() as { created_at?: string };
    return {
      id: doc._id.toString(),
      request_no: doc.request_no,
      requesting_office_id: doc.requesting_office_id.toString(),
      source_office_id: doc.source_office_id.toString(),
      requesting_office_name: doc.requesting_office_name,
      source_office_name: doc.source_office_name,
      items_count: doc.items_count,
      units: doc.units,
      status: doc.status,
      note: doc.note ?? '',
      decline_reason: doc.decline_reason ?? '',
      transfer_id: doc.transfer_id ? doc.transfer_id.toString() : null,
      reviewed_at: doc.reviewed_at ? doc.reviewed_at.toISOString() : null,
      created_at: json.created_at ?? null,
    };
  }

  private async nextRequestNo(officeId: string): Promise<string> {
    const seq = await this.counters.next(`stock_request:${officeId}`);
    return `REQ-${String(seq).padStart(4, '0')}`;
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

  private assertObjectId(id: string, field = 'id') {
    if (!isValidObjectId(id)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { [field]: [`${field} must be a valid id`] },
      });
    }
  }

  private toObjectIdOrNull(id?: string): Types.ObjectId | null {
    return id && isValidObjectId(id) ? new Types.ObjectId(id) : null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
