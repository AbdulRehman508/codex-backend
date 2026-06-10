import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OfficeDocument = HydratedDocument<Office>;

export enum MembershipLevel {
  GOLD = 'gold',
  PREMIUM = 'premium',
  SILVER = 'silver',
}

export enum MembershipType {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum OfficeStatus {
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
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Office {
  @Prop({ required: true, trim: true })
  office_name!: string;

  // unique index declared below so soft-deleted rows can be excluded (partial index)
  @Prop({ required: true, lowercase: true, trim: true })
  office_email!: string;

  @Prop({ required: true, trim: true })
  office_mobile_no!: string;

  @Prop({ required: true, enum: MembershipLevel })
  membership_level!: MembershipLevel;

  @Prop({ required: true, enum: MembershipType })
  membership_type!: MembershipType;

  @Prop({ trim: true })
  licence_no?: string;

  @Prop({ default: false })
  approved!: boolean;

  @Prop({ required: true, enum: OfficeStatus, default: OfficeStatus.ACTIVE })
  office_status!: OfficeStatus;

  @Prop({ required: true, trim: true })
  office_address!: string;

  @Prop()
  biography?: string;

  // stored URL/path, never raw base64
  @Prop()
  office_logo?: string;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const OfficeSchema = SchemaFactory.createForClass(Office);

// unique email only among non-deleted offices
OfficeSchema.index(
  { office_email: 1 },
  {
    unique: true,
    partialFilterExpression: { deleted_at: null },
  },
);
