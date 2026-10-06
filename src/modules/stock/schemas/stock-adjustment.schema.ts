import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type StockAdjustmentDocument = HydratedDocument<StockAdjustment>;

export enum AdjustmentType {
  /** units added outside a purchase (found, customer return, correction up) */
  INCREASE = 'increase',
  /** units written off (damaged, lost, expired, correction down) */
  DECREASE = 'decrease',
  /** a physical count replaces the figure on file */
  RECOUNT = 'recount',
}

export enum AdjustmentReason {
  DAMAGED = 'damaged',
  LOST = 'lost',
  EXPIRED = 'expired',
  FOUND = 'found',
  RETURN = 'return',
  CORRECTION = 'correction',
  OTHER = 'other',
}

/**
 * One stock movement that was neither a sale nor a purchase. Entries are an
 * audit trail: they are never edited or deleted — a mistake is corrected by
 * posting the opposite entry, so the history always explains the count.
 */
@Schema({
  collection: 'stock_adjustments',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        product_id?: unknown;
        created_by?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.product_id) obj.product_id = String(obj.product_id);
      if (obj.created_by) obj.created_by = String(obj.created_by);
      return obj;
    },
  },
})
export class StockAdjustment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product_id!: Types.ObjectId;

  // snapshots, so a renamed product never rewrites an old entry
  @Prop({ required: true, trim: true })
  product_name!: string;

  @Prop({ trim: true, default: '' })
  sku!: string;

  @Prop({ required: true, enum: AdjustmentType })
  type!: AdjustmentType;

  @Prop({ required: true, enum: AdjustmentReason })
  reason!: AdjustmentReason;

  /** units moved, always positive — `type` carries the direction */
  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  before_quantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  after_quantity!: number;

  @Prop({ trim: true, default: '' })
  note!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;
}

export const StockAdjustmentSchema =
  SchemaFactory.createForClass(StockAdjustment);

StockAdjustmentSchema.index({ office_id: 1, created_at: -1 });
StockAdjustmentSchema.index({ product_id: 1, created_at: -1 });
