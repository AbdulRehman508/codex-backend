import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CustomerPaymentDocument = HydratedDocument<CustomerPayment>;

/**
 * One payment a customer made against their borrow balance. The balance on the
 * customer is the running total; these rows are the trail of how it came down.
 */
@Schema({
  collection: 'customer_payments',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        customer_id?: unknown;
        received_by?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.customer_id) obj.customer_id = String(obj.customer_id);
      if (obj.received_by) obj.received_by = String(obj.received_by);
      return obj;
    },
  },
})
export class CustomerPayment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Customer', required: true })
  customer_id!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0.01 })
  amount!: number;

  // balance left on the customer right after this payment
  @Prop({ type: Number, required: true, min: 0 })
  balance_after!: number;

  @Prop({ trim: true })
  note?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  received_by?: Types.ObjectId | null;
}

export const CustomerPaymentSchema =
  SchemaFactory.createForClass(CustomerPayment);

// a customer's payment history, newest first
CustomerPaymentSchema.index({ customer_id: 1, created_at: -1 });
