import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CustomerDocument = HydratedDocument<Customer>;

export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * A shop customer. Scoped to one office, like roles and racks — each branch
 * keeps its own customer book. Email and CNIC are optional (walk-in buyers
 * rarely hand them over) but must stay unique inside the office when given.
 */
@Schema({
  collection: 'customers',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Customer {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  first_name!: string;

  // optional so a sale can create a customer from a single typed name
  @Prop({ trim: true, default: '' })
  last_name!: string;

  // optional — unique per office only when present (partial index below)
  @Prop({ type: String, lowercase: true, trim: true, default: null })
  email?: string | null;

  @Prop({ required: true, trim: true })
  mobile_no!: string;

  @Prop({ type: String, trim: true, default: null })
  cnic_no?: string | null;

  @Prop({ trim: true, default: '' })
  address!: string;

  @Prop()
  biography?: string;

  // stored URL/path, never raw base64
  @Prop({ type: String, default: null })
  profile_photo?: string | null;

  // running unpaid balance: every borrowed sale adds to it
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  borrow_amount!: number;

  @Prop({
    required: true,
    enum: CustomerStatus,
    default: CustomerStatus.ACTIVE,
  })
  customer_status!: CustomerStatus;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

// email / cnic unique inside an office, and only for rows that carry one
CustomerSchema.index(
  { office_id: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { deleted_at: null, email: { $type: 'string' } },
  },
);
CustomerSchema.index(
  { office_id: 1, cnic_no: 1 },
  {
    unique: true,
    partialFilterExpression: { deleted_at: null, cnic_no: { $type: 'string' } },
  },
);
// list grid: filter by office, newest first
CustomerSchema.index({ office_id: 1, deleted_at: 1, created_at: -1 });
