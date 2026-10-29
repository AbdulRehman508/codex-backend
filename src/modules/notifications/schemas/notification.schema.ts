import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

/**
 * Something a branch should be told about.
 *
 * The live stream already nudges open screens, but a nudge is gone the moment
 * nobody is looking. This is the part that waits: the bell shows what happened
 * while the branch was closed, and keeps showing it until someone reads it.
 *
 * The text is not stored. A key and its values are, so the same notification
 * reads in English or Urdu depending on who opens it.
 */
@Schema({
  collection: 'notifications',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    },
  },
})
export class Notification {
  /** the branch this is addressed to */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  /** e.g. 'stock-request.created' — also what the icon is chosen from */
  @Prop({ required: true, trim: true })
  type!: string;

  /** i18n key the UI renders, e.g. 'notif.requestCreated' */
  @Prop({ required: true, trim: true })
  title_key!: string;

  /** the values that key interpolates: request number, branch name, reason */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  params!: Record<string, string>;

  /** where clicking it goes, e.g. '/stock/requests' */
  @Prop({ trim: true, default: '' })
  link!: string;

  /** query parameters for that route, so the screen can open the right row */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  link_params!: Record<string, string>;

  /** the document this is about, so a second event can supersede the first */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  ref_id?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  read_at?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// the bell reads the newest first, and counts the unread, for one branch
NotificationSchema.index({ office_id: 1, created_at: -1 });
NotificationSchema.index({ office_id: 1, read_at: 1 });

// A notification is news, and news goes stale. Mongo drops them after 60 days
// so the collection cannot grow forever on a till that runs for years.
NotificationSchema.index({ created_at: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });
