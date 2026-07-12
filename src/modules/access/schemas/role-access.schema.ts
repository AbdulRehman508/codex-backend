import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RoleAccessDocument = HydratedDocument<RoleAccess>;

// One CRUD permission row for a single module (embedded, no own _id).
@Schema({ _id: false })
export class ModulePermission {
  // catalog key from ACCESS_MODULES (e.g. 'dashboard')
  @Prop({ required: true, trim: true })
  module!: string;

  @Prop({ default: false })
  view!: boolean;

  @Prop({ default: false })
  create!: boolean;

  @Prop({ default: false })
  edit!: boolean;

  @Prop({ default: false })
  delete!: boolean;
}

export const ModulePermissionSchema =
  SchemaFactory.createForClass(ModulePermission);

// Numeric primary key so the contract stays { id, role_id, ... } like roles.
// One document per role; office_id is mirrored from the role so access is
// inherently office-scoped (a role belongs to exactly one office).
@Schema({
  _id: false,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
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
export class RoleAccess {
  @Prop({ type: Number })
  _id!: number;

  @Prop({ type: Number, ref: 'Role', required: true })
  role_id!: number;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ type: [ModulePermissionSchema], default: [] })
  permissions!: ModulePermission[];
}

export const RoleAccessSchema = SchemaFactory.createForClass(RoleAccess);

// exactly one access record per role
RoleAccessSchema.index({ role_id: 1 }, { unique: true });
