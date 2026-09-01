import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type StaffDocument = HydratedDocument<Staff>;

export enum StaffStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Schema({
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        password?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      delete obj.password;
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Staff {
  @Prop({ required: true, trim: true })
  first_name!: string;

  @Prop({ required: true, trim: true })
  last_name!: string;

  // unique index declared below (partial) so soft-deleted rows are excluded
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  // bcrypt hash, never selected/returned
  @Prop({ required: true, select: false })
  password!: string;

  @Prop({ required: true, trim: true })
  mobile_no!: string;

  // Pakistani CNIC XXXXX-XXXXXXX-X — unique partial index below
  @Prop({ required: true, trim: true })
  cnic_no!: string;

  // a staff member can belong to multiple offices
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Office' }],
    required: true,
  })
  office_ids!: Types.ObjectId[];

  @Prop({ type: Number, ref: 'Role', required: true })
  role_id!: number;

  // office last picked in the header; re-selected automatically on next login
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Office',
    default: null,
  })
  last_office_id?: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  address!: string;

  @Prop({ type: Number, min: 0, default: 0 })
  salary!: number;

  @Prop()
  biography?: string;

  // stored URL/path, never raw base64
  @Prop({ type: String, default: null })
  profile_photo?: string | null;

  @Prop({ required: true, enum: StaffStatus, default: StaffStatus.ACTIVE })
  staff_status!: StaffStatus;

  // password-reset: sha256(token) + expiry, single-use. Hidden from responses.
  @Prop({ type: String, default: null, select: false })
  reset_token_hash?: string | null;

  @Prop({ type: Date, default: null, select: false })
  reset_token_expires?: Date | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const StaffSchema = SchemaFactory.createForClass(Staff);

// unique email/cnic only among non-deleted staff
StaffSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
StaffSchema.index(
  { cnic_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
