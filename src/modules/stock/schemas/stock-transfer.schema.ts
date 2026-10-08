import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type StockTransferDocument = HydratedDocument<StockTransfer>;

/**
 * One product moving between branches. `product_id` is the source office's
 * product; `to_product_id` is its twin in the receiving office, created from
 * the source product the first time that branch sees this SKU.
 */
@Schema({ _id: false })
export class TransferLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  to_product_id!: Types.ObjectId;

  // snapshots, so a renamed product never rewrites an old transfer
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true, default: '' })
  sku!: string;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;
}

export const TransferLineSchema = SchemaFactory.createForClass(TransferLine);

/**
 * Stock moving from one branch to another. Recorded as a single document so
 * both ends read the same history; deleting one puts the units back.
 */
@Schema({
  collection: 'stock_transfers',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        from_office_id?: unknown;
        to_office_id?: unknown;
        created_by?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.from_office_id) obj.from_office_id = String(obj.from_office_id);
      if (obj.to_office_id) obj.to_office_id = String(obj.to_office_id);
      if (obj.created_by) obj.created_by = String(obj.created_by);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class StockTransfer {
  // TRF-0001, sequential per sending office
  @Prop({ required: true, uppercase: true, trim: true })
  transfer_no!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  from_office_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  to_office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  from_office_name!: string;

  @Prop({ required: true, trim: true })
  to_office_name!: string;

  @Prop({ type: [TransferLineSchema], required: true, default: [] })
  lines!: TransferLine[];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  items_count!: number;

  /** total units moved, across every line */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  units!: number;

  @Prop({ trim: true, default: '' })
  note!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const StockTransferSchema = SchemaFactory.createForClass(StockTransfer);

StockTransferSchema.index(
  { from_office_id: 1, transfer_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
StockTransferSchema.index({ from_office_id: 1, deleted_at: 1, created_at: -1 });
StockTransferSchema.index({ to_office_id: 1, deleted_at: 1, created_at: -1 });
