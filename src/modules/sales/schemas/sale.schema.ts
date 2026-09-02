import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SaleDocument = HydratedDocument<Sale>;

export enum PaymentMethod {
  CASH = 'cash',
  ONLINE = 'online',
}

export enum SaleStatus {
  COMPLETED = 'completed',
  PENDING = 'pending',
  REFUNDED = 'refunded',
}

/** A sale only holds stock while it is not refunded. */
export const STOCK_HOLDING_STATUSES: SaleStatus[] = [
  SaleStatus.COMPLETED,
  SaleStatus.PENDING,
];

/**
 * One line of a sale. Name/sku/price are snapshots taken at sale time so a
 * later product rename or price change never rewrites history.
 */
@Schema({ _id: false })
export class SaleLine {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true, default: '' })
  sku!: string;

  @Prop({ type: Number, required: true, min: 0 })
  price!: number;

  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0 })
  total!: number;
}

export const SaleLineSchema = SchemaFactory.createForClass(SaleLine);

@Schema({
  collection: 'sales',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        sold_by?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.sold_by) obj.sold_by = String(obj.sold_by);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Sale {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  // INV-0001, sequential per office — unique index below
  @Prop({ required: true, uppercase: true, trim: true })
  invoice_no!: string;

  @Prop({ required: true, trim: true, default: 'Walk-in' })
  customer_name!: string;

  @Prop({ required: true, enum: PaymentMethod, default: PaymentMethod.CASH })
  payment_method!: PaymentMethod;

  @Prop({ type: [SaleLineSchema], required: true, default: [] })
  lines!: SaleLine[];

  // total units across all lines (what the grid's "Items" column shows)
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  items_count!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  subtotal!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  discount!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  total!: number;

  @Prop({ required: true, enum: SaleStatus, default: SaleStatus.COMPLETED })
  status!: SaleStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  sold_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const SaleSchema = SchemaFactory.createForClass(Sale);

// invoice numbers are unique inside an office
SaleSchema.index(
  { office_id: 1, invoice_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
// list grid + stats both filter by office and sort/range on created_at
SaleSchema.index({ office_id: 1, deleted_at: 1, created_at: -1 });
