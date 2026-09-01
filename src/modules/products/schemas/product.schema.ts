import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * A stock item. Its physical storage slot is a foreign key to a single
 * `rack_locations` document (rack -> row -> column -> bin), never free text.
 */
@Schema({
  collection: 'products',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as {
        _id?: { toString(): string };
        id?: string;
        office_id?: unknown;
        rack_location_id?: unknown;
        created_by?: unknown;
        updated_by?: unknown;
        deleted_at?: unknown;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      if (obj.rack_location_id) {
        obj.rack_location_id = String(obj.rack_location_id);
      }
      if (obj.created_by) obj.created_by = String(obj.created_by);
      if (obj.updated_by) obj.updated_by = String(obj.updated_by);
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Product {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  // unique per office among non-deleted products (partial index below)
  @Prop({ required: true, uppercase: true, trim: true })
  sku!: string;

  @Prop({ type: String, trim: true, default: null })
  barcode?: string | null;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  price!: number;

  // units currently held in this product's bin
  @Prop({ type: Number, required: true, min: 0, default: 0 })
  quantity!: number;

  @Prop({ trim: true })
  description?: string;

  // exact bin the product sits in; null = not yet assigned
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'RackLocation',
    default: null,
  })
  rack_location_id?: Types.ObjectId | null;

  @Prop({ required: true, enum: ProductStatus, default: ProductStatus.ACTIVE })
  status!: ProductStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  updated_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// sku unique per office, barcode unique per office when present
ProductSchema.index(
  { office_id: 1, sku: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
ProductSchema.index(
  { office_id: 1, barcode: 1 },
  {
    unique: true,
    partialFilterExpression: { deleted_at: null, barcode: { $type: 'string' } },
  },
);
// "is this bin in use?" lookups when a rack shrinks or is deleted
ProductSchema.index({ rack_location_id: 1, deleted_at: 1 });
ProductSchema.index({ office_id: 1, deleted_at: 1, created_at: -1 });
