import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RackLocationDocument = HydratedDocument<RackLocation>;

export enum RackLocationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * One physical bin inside a rack (rack -> row -> column -> bin). Stored as its
 * own document so a product can reference it by id (`rack_location_id`) rather
 * than by text.
 */
@Schema({
  collection: 'rack_locations',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        rack_id?: unknown;
        office_id?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.rack_id) obj.rack_id = String(obj.rack_id);
      if (obj.office_id) obj.office_id = String(obj.office_id);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class RackLocation {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Rack', required: true })
  rack_id!: Types.ObjectId;

  // denormalised from the rack so office-scoped queries need no join
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  row_no!: number;

  @Prop({ type: Number, required: true, min: 1 })
  column_no!: number;

  @Prop({ type: Number, required: true, min: 1 })
  bin_no!: number;

  // e.g. RACK-A-R1-C2-B3 — unique per office among non-deleted bins
  @Prop({ required: true, uppercase: true, trim: true })
  location_code!: string;

  @Prop({
    required: true,
    enum: RackLocationStatus,
    default: RackLocationStatus.ACTIVE,
  })
  status!: RackLocationStatus;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const RackLocationSchema = SchemaFactory.createForClass(RackLocation);

// location code never repeats inside an office (soft-deleted rows excluded).
// Scoped per office because the rack code it derives from is itself per-office.
RackLocationSchema.index(
  { office_id: 1, location_code: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
// one document per physical slot
RackLocationSchema.index(
  { rack_id: 1, row_no: 1, column_no: 1, bin_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
// dependent dropdowns: rows -> columns -> bins of a rack
RackLocationSchema.index({ rack_id: 1, deleted_at: 1, row_no: 1, column_no: 1, bin_no: 1 });
RackLocationSchema.index({ office_id: 1, deleted_at: 1 });
