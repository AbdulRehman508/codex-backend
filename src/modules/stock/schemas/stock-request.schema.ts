import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type StockRequestDocument = HydratedDocument<StockRequest>;

export enum StockRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
}

/**
 * One product asked for. `product_id` is the holding branch's product, since
 * that is the stock being asked for; the requesting branch may not even carry
 * the SKU yet — it gets its own record when the goods actually move.
 */
@Schema({ _id: false })
export class RequestLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product_id!: Types.ObjectId;

  // snapshots, so a renamed product never rewrites an old request
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true, default: '' })
  sku!: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  /**
   * What the holding branch had when the request was written. Kept because the
   * figure the requester saw is part of the story — by approval time it may
   * have sold down, and the two offices need to see the same history.
   */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  available_at_request!: number;
}

export const RequestLineSchema = SchemaFactory.createForClass(RequestLine);

/**
 * One branch asking another for stock.
 *
 * Nothing moves when this is written: it is a question. The holding branch
 * answers it, and only an approval creates the transfer that actually shifts
 * the units. A decline has to say why, because "no" without a reason sends the
 * requester back to ask again.
 */
@Schema({
  collection: 'stock_requests',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as Record<string, unknown> & {
        _id?: { toString(): string };
        id?: string;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      for (const key of [
        'requesting_office_id',
        'source_office_id',
        'requested_by',
        'reviewed_by',
        'transfer_id',
      ]) {
        if (obj[key]) obj[key] = String(obj[key]);
      }
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class StockRequest {
  // REQ-0001, sequential per requesting office
  @Prop({ required: true, uppercase: true, trim: true })
  request_no!: string;

  /** the branch that is short of stock and wants it */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  requesting_office_id!: Types.ObjectId;

  /** the branch that holds the stock and answers the request */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  source_office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  requesting_office_name!: string;

  @Prop({ required: true, trim: true })
  source_office_name!: string;

  @Prop({ type: [RequestLineSchema], required: true, default: [] })
  lines!: RequestLine[];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  items_count!: number;

  /** total units asked for, across every line */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  units!: number;

  @Prop({
    type: String,
    enum: Object.values(StockRequestStatus),
    default: StockRequestStatus.PENDING,
    index: true,
  })
  status!: StockRequestStatus;

  /** why the requester needs it */
  @Prop({ trim: true, default: '' })
  note!: string;

  /** required on a decline — the requester is owed an answer */
  @Prop({ trim: true, default: '' })
  decline_reason!: string;

  /** the move an approval created; null until then */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'StockTransfer', default: null })
  transfer_id?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  requested_by?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  reviewed_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewed_at?: Date | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const StockRequestSchema = SchemaFactory.createForClass(StockRequest);

StockRequestSchema.index(
  { requesting_office_id: 1, request_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
// the two lists each screen draws: what we asked for, what we are asked for
StockRequestSchema.index({ requesting_office_id: 1, deleted_at: 1, created_at: -1 });
StockRequestSchema.index({ source_office_id: 1, status: 1, deleted_at: 1, created_at: -1 });
