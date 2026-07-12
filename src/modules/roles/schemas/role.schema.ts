import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RoleDocument = HydratedDocument<Role>;

// Numeric primary key so the contract returns { id: 1, role: 'Admin' }.
@Schema({
  _id: false,
  timestamps: false,
  toJSON: {
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as unknown as {
        _id?: number;
        id?: number;
        office_id?: unknown;
      };
      obj.id = obj._id;
      delete obj._id;
      if (obj.office_id) obj.office_id = String(obj.office_id);
      return obj;
    },
  },
})
export class Role {
  @Prop({ type: Number })
  _id!: number;

  @Prop({ required: true, trim: true })
  role!: string;

  @Prop({ trim: true })
  description?: string;

  // roles are scoped to an office now
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;
}

export const RoleSchema = SchemaFactory.createForClass(Role);

// role name is unique within an office, not globally
RoleSchema.index({ office_id: 1, role: 1 }, { unique: true });
