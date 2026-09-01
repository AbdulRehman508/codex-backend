import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RackDocument = HydratedDocument<Rack>;

export enum RackStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * A physical rack in a warehouse. The individual bins it is made of live in
 * the `rack_locations` collection (one document per bin) so products can hold
 * a foreign key to an exact physical slot.
 */
@Schema({
  collection: 'racks',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        created_by?: unknown;
        updated_by?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.created_by) obj.created_by = String(obj.created_by);
      if (obj.updated_by) obj.updated_by = String(obj.updated_by);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Rack {
  // racks belong to exactly one office (same scoping rule as roles)
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  // uppercase business code — unique per office, see partial index below
  @Prop({ required: true, uppercase: true, trim: true })
  code!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, enum: RackStatus, default: RackStatus.ACTIVE })
  status!: RackStatus;

  // grid the bins were generated from; kept so edit can grow/shrink the rack
  @Prop({ type: Number, required: true, min: 1 })
  rows_count!: number;

  @Prop({ type: Number, required: true, min: 1 })
  columns_count!: number;

  @Prop({ type: Number, required: true, min: 1 })
  bins_count!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  updated_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const RackSchema = SchemaFactory.createForClass(Rack);

// rack code is unique within an office, and only among non-deleted racks
RackSchema.index(
  { office_id: 1, code: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
// list grid: filter by office + sort
RackSchema.index({ office_id: 1, deleted_at: 1, created_at: -1 });
