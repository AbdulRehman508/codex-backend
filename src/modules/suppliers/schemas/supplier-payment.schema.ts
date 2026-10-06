import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SupplierPaymentDocument = HydratedDocument<SupplierPayment>;

/** A payment the shop made to a supplier against its payable balance. */
@Schema({
  collection: 'supplier_payments',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        supplier_id?: unknown;
        paid_by?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.supplier_id) obj.supplier_id = String(obj.supplier_id);
      if (obj.paid_by) obj.paid_by = String(obj.paid_by);
      return obj;
    },
  },
})
export class SupplierPayment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Supplier', required: true })
  supplier_id!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0.01 })
  amount!: number;

  // balance left on the supplier right after this payment
  @Prop({ type: Number, required: true, min: 0 })
  balance_after!: number;

  @Prop({ trim: true })
  note?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  paid_by?: Types.ObjectId | null;
}

export const SupplierPaymentSchema =
  SchemaFactory.createForClass(SupplierPayment);

SupplierPaymentSchema.index({ supplier_id: 1, created_at: -1 });
