import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  OTHER = 'other',
}

/**
 * Who changed what. Written after a request succeeds, never in its path: an
 * audit write that fails must not fail the user's action. Entries hold a
 * reference and a label, never the request body — bodies carry passwords and
 * base64 images, and a log is not the place for either.
 */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        user_id?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.user_id) obj.user_id = String(obj.user_id);
      return obj;
    },
  },
})
export class AuditLog {
  /** branch the change belongs to, when the call named one */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', default: null })
  office_id?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  user_id?: Types.ObjectId | null;

  // snapshots, so a deleted or renamed user still reads correctly
  @Prop({ trim: true, default: '' })
  user_name!: string;

  @Prop({ trim: true, default: '' })
  user_email!: string;

  /** access-catalog key: products, sales, purchase, stock ... */
  @Prop({ trim: true, default: '' })
  module!: string;

  @Prop({ required: true, enum: AuditAction, default: AuditAction.OTHER })
  action!: AuditAction;

  /** the record that was touched, when the response named one */
  @Prop({ trim: true, default: '' })
  entity_id!: string;

  /** how a human recognises it: an invoice no, a product name, ... */
  @Prop({ trim: true, default: '' })
  entity_label!: string;

  @Prop({ trim: true, default: '' })
  method!: string;

  @Prop({ trim: true, default: '' })
  path!: string;

  @Prop({ type: Number, default: 200 })
  status_code!: number;

  @Prop({ trim: true, default: '' })
  ip!: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ created_at: -1 });
AuditLogSchema.index({ office_id: 1, created_at: -1 });
AuditLogSchema.index({ user_id: 1, created_at: -1 });
AuditLogSchema.index({ module: 1, action: 1, created_at: -1 });
// the trail keeps six months, then rolls off on its own
AuditLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
