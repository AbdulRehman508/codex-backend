import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PurchaseDocument = HydratedDocument<Purchase>;

export enum PurchaseStatus {
  /** goods are in: stock has been raised and the bill is payable */
  RECEIVED = 'received',
  /** ordered but not delivered: no stock movement yet */
  ORDERED = 'ordered',
  /** written off: stock and payable both released */
  CANCELLED = 'cancelled',
}

/** Statuses that actually hold stock and a payable. */
export const ACTIVE_PURCHASE_STATUSES: PurchaseStatus[] = [
  PurchaseStatus.RECEIVED,
];

/**
 * One line of a purchase. Name/sku are snapshots, cost_price is what this
 * batch cost — the product's own price stays the selling price.
 */
@Schema({ _id: false })
export class PurchaseLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true, default: '' })
  sku!: string;

  @Prop({ type: Number, required: true, min: 0 })
  cost_price!: number;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  total!: number;

  /** supplier batch / lot number, when the goods carry one */
  @Prop({ trim: true, default: '' })
  batch_no!: string;

  /** when this lot expires; feeds the expiry report */
  @Prop({ type: Date, default: null })
  expiry_date?: Date | null;
}

export const PurchaseLineSchema = SchemaFactory.createForClass(PurchaseLine);

@Schema({
  collection: 'purchases',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        supplier_id?: unknown;
        created_by?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.supplier_id) obj.supplier_id = String(obj.supplier_id);
      if (obj.created_by) obj.created_by = String(obj.created_by);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Purchase {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  // PUR-0001, sequential per office
  @Prop({ required: true, uppercase: true, trim: true })
  purchase_no!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Supplier', required: true })
  supplier_id!: Types.ObjectId;

  // snapshot, so a renamed supplier never rewrites an old bill
  @Prop({ required: true, trim: true })
  supplier_name!: string;

  /** the supplier's own bill number, as printed on their invoice */
  @Prop({ trim: true, default: '' })
  supplier_invoice_no!: string;

  @Prop({ type: [PurchaseLineSchema], required: true, default: [] })
  lines!: PurchaseLine[];

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  items_count!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discount!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  total!: number;

  /** paid to the supplier at the time of the bill */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  paid_amount!: number;

  /** total - paid; mirrored onto the supplier's payable balance */
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  due_amount!: number;

  @Prop({
    required: true,
    enum: PurchaseStatus,
    default: PurchaseStatus.RECEIVED,
  })
  status!: PurchaseStatus;

  @Prop({ trim: true, default: '' })
  notes!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);

PurchaseSchema.index(
  { office_id: 1, purchase_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
PurchaseSchema.index({ office_id: 1, deleted_at: 1, created_at: -1 });
PurchaseSchema.index({ supplier_id: 1, deleted_at: 1 });
