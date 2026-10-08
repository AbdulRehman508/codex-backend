import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ProductLotDocument = HydratedDocument<ProductLot>;

/**
 * A lot of goods as it was received: batch number, expiry and how many units
 * came in on that bill.
 *
 * This is a register, not a second stock ledger. Stock itself lives on the
 * product; a lot records what arrived and when it runs out of date, which is
 * what the expiry report reads. Units are written off through a stock
 * adjustment (reason "expired"), the same as any other loss.
 */
@Schema({
  collection: 'product_lots',
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
        purchase_id?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.product_id) obj.product_id = String(obj.product_id);
      if (obj.purchase_id) obj.purchase_id = String(obj.purchase_id);
      return obj;
    },
  },
})
export class ProductLot {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  product_id!: Types.ObjectId;

  // snapshots, so a renamed product still reads correctly on the report
  @Prop({ required: true, trim: true })
  product_name!: string;

  @Prop({ trim: true, default: '' })
  sku!: string;

  @Prop({ trim: true, default: '' })
  batch_no!: string;

  /** null when the goods carry a batch number but no date */
  @Prop({ type: Date, default: null })
  expiry_date?: Date | null;

  /** units received on this lot */
  @Prop({ type: Number, required: true, min: 1 })
  quantity!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  cost_price!: number;

  // the bill it came in on; the lot goes when that bill is reversed
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Purchase', required: true })
  purchase_id!: Types.ObjectId;

  @Prop({ trim: true, default: '' })
  purchase_no!: string;

  @Prop({ trim: true, default: '' })
  supplier_name!: string;
}

export const ProductLotSchema = SchemaFactory.createForClass(ProductLot);

ProductLotSchema.index({ office_id: 1, expiry_date: 1 });
ProductLotSchema.index({ product_id: 1, expiry_date: 1 });
ProductLotSchema.index({ purchase_id: 1 });
