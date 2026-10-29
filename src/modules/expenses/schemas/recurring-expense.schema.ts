import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ExpensePaymentMethod } from './expense.schema';

export type RecurringExpenseDocument = HydratedDocument<RecurringExpense>;

export enum RecurringFrequency {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

/**
 * A bill that comes round again: rent on the 1st, wages on the 5th.
 *
 * This is a standing instruction, not an expense. Each time it falls due an
 * ordinary expense is written from it, so every figure in the app keeps
 * reading one collection and nothing has to know about schedules.
 */
@Schema({
  collection: 'recurring_expenses',
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
export class RecurringExpense {
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
  })
  payment_method!: ExpensePaymentMethod;

  @Prop({ trim: true, default: '' })
  paid_to!: string;

  @Prop({ trim: true, default: '' })
  note!: string;

  @Prop({
    type: String,
    enum: Object.values(RecurringFrequency),
    default: RecurringFrequency.MONTHLY,
  })
  frequency!: RecurringFrequency;

  /**
   * 1-31 for a monthly bill, 0-6 (Sunday first) for a weekly one. A monthly
   * 31st in a short month falls on the last day rather than skipping.
   */
  @Prop({ type: Number, required: true, min: 0, max: 31 })
  day!: number;

  /**
   * The next date this is due. It is the whole mechanism: a bill is written
   * when the date has passed, and this moves forward. Nothing else decides
   * whether an entry already exists.
   */
  @Prop({ type: Date, required: true, index: true })
  next_run!: Date;

  /** when it last wrote an expense, for the "last charged" line */
  @Prop({ type: Date, default: null })
  last_run?: Date | null;

  /** paused instead of deleted, so the history keeps its reason */
  @Prop({ type: Boolean, default: true })
  active!: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Staff', default: null })
  created_by?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deleted_at?: Date | null;
}

export const RecurringExpenseSchema =
  SchemaFactory.createForClass(RecurringExpense);

// the sweep reads exactly this: live, active, and due
RecurringExpenseSchema.index({ deleted_at: 1, active: 1, next_run: 1 });
RecurringExpenseSchema.index({ office_id: 1, deleted_at: 1 });
