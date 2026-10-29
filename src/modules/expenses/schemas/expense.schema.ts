import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ExpenseDocument = HydratedDocument<Expense>;

/** How the money left the shop. Only cash comes out of the till. */
export enum ExpensePaymentMethod {
  CASH = 'cash',
  ONLINE = 'online',
}

/**
 * The categories a shop starts with. They are suggestions, not a fixed list:
 * the category is stored as text, so a shop can type its own and it shows up
 * in the picker from then on. A hard enum would have every shop asking for
 * one more value.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Salaries',
  'Utilities',
  'Transport',
  'Tea & refreshments',
  'Repairs',
  'Marketing',
  'Other',
] as const;

/**
 * Money the shop spent that is not stock.
 *
 * Stock bought from a supplier is a purchase, not an expense — it becomes
 * inventory. This is everything else: rent, wages, electricity, the chai. It
 * is what stands between "what the till took" and "what the shop earned".
 */
@Schema({
  collection: 'expenses',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret) => {
      const obj = ret as Record<string, unknown> & {
        _id?: { toString(): string };
        id?: string;
      };
      obj.id = obj._id ? obj._id.toString() : undefined;
      delete obj._id;
      for (const key of ['office_id', 'created_by']) {
        if (obj[key]) obj[key] = String(obj[key]);
      }
      delete obj.deleted_at;
      return obj;
    },
  },
})
export class Expense {
  // EXP-0001, sequential per office
  @Prop({ required: true, uppercase: true, trim: true })
  expense_no!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Office', required: true })
  office_id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  category!: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({
    type: String,
    enum: Object.values(ExpensePaymentMethod),
    default: ExpensePaymentMethod.CASH,
    index: true,
  })
  payment_method!: ExpensePaymentMethod;

  /**
   * When the money actually went out, which is not always when it was typed
   * in — a shopkeeper enters yesterday's bill this morning. Every report
   * reads this, never created_at.
   */
  @Prop({ type: Date, required: true })
  spent_at!: Date;

  /** who was paid: a landlord, an electrician, a name on a receipt */
  @Prop({ trim: true, default: '' })
  paid_to!: string;

  @Prop({ trim: true, default: '' })
  note!: string;

  /**
   * The bill itself, photographed. Stored as a URL the way product and staff
   * images are; a base64 data URL on write replaces it.
   */
  @Prop({ type: String, trim: true, default: null })
  receipt?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);

ExpenseSchema.index(
  { office_id: 1, expense_no: 1 },
  { unique: true, partialFilterExpression: { deleted_at: null } },
);
// the day sheet and the period reports both read by date within an office
ExpenseSchema.index({ office_id: 1, deleted_at: 1, spent_at: -1 });
ExpenseSchema.index({ office_id: 1, category: 1, deleted_at: 1 });
