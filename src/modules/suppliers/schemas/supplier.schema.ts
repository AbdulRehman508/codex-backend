import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SupplierDocument = HydratedDocument<Supplier>;

export enum SupplierStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * Who the shop buys from. Office-scoped like everything else. `payable_amount`
 * is the mirror of a customer's borrow: what this branch still owes them.
 */
@Schema({
  collection: 'suppliers',
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
export class Supplier {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true, default: '' })
  company!: string;

  @Prop({ required: true, trim: true })
  mobile_no!: string;

  @Prop({ type: String, lowercase: true, trim: true, default: null })
  email?: string | null;

  @Prop({ trim: true, default: '' })
  address!: string;

  @Prop({ trim: true, default: '' })
  notes!: string;

  // running unpaid balance across purchases
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  payable_amount!: number;

  @Prop({
    required: true,
    enum: SupplierStatus,
    default: SupplierStatus.ACTIVE,
  })
  status!: SupplierStatus;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const SupplierSchema = SchemaFactory.createForClass(Supplier);

// one mobile per supplier inside an office (soft-deleted rows excluded)
SupplierSchema.index(
  { office_id: 1, mobile_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
SupplierSchema.index({ office_id: 1, deleted_at: 1, created_at: -1 });
