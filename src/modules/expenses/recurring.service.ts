import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import {
  CreateRecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from './dto/recurring-expense.dto';
import {
  Expense,
  ExpenseDocument,
  ExpensePaymentMethod,
} from './schemas/expense.schema';
import {
  RecurringExpense,
  RecurringExpenseDocument,
  RecurringFrequency,
} from './schemas/recurring-expense.schema';

export interface RecurringRow {
  id: string;
  office_id: string;
  category: string;
  amount: number;
  payment_method: ExpensePaymentMethod;
  paid_to: string;
  note: string;
  frequency: RecurringFrequency;
  day: number;
  next_run: string | null;
  last_run: string | null;
  active: boolean;
}

@Injectable()
export class RecurringExpensesService {
  constructor(
    @InjectModel(RecurringExpense.name)
    private readonly recurringModel: Model<RecurringExpenseDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    private readonly counters: CountersService,
  ) {}

  // ---------- the standing instructions ----------

  async create(
    dto: CreateRecurringExpenseDto,
    userId?: string,
  ): Promise<RecurringExpenseDocument> {
    const office = await this.office(dto.office_id);
    const frequency = dto.frequency ?? RecurringFrequency.MONTHLY;
    this.assertDay(frequency, dto.day);

    return this.recurringModel.create({
      office_id: office._id,
      category: dto.category.trim(),
      amount: dto.amount,
      payment_method: dto.payment_method ?? ExpensePaymentMethod.CASH,
      paid_to: dto.paid_to?.trim() ?? '',
      note: dto.note?.trim() ?? '',
      frequency,
      day: dto.day,
      // by default the first one is due on the next matching date — a bill
      // the shop already paid by hand should not appear in arrears. A
      // start_from in the past is the deliberate opposite: backfill it.
      next_run: dto.start_from
        ? new Date(dto.start_from)
        : nextDate(new Date(), frequency, dto.day),
      active: dto.active ?? true,
      created_by: this.toObjectIdOrNull(userId),
    });
  }

  async update(
    id: string,
    dto: UpdateRecurringExpenseDto,
  ): Promise<RecurringExpenseDocument> {
    const doc = await this.findOne(id);
    if (dto.category !== undefined) doc.category = dto.category.trim();
    if (dto.amount !== undefined) doc.amount = dto.amount;
    if (dto.payment_method !== undefined) doc.payment_method = dto.payment_method;
    if (dto.paid_to !== undefined) doc.paid_to = dto.paid_to.trim();
    if (dto.note !== undefined) doc.note = dto.note.trim();
    if (dto.active !== undefined) doc.active = dto.active;

    if (dto.frequency !== undefined || dto.day !== undefined) {
      const frequency = dto.frequency ?? doc.frequency;
      const day = dto.day ?? doc.day;
      this.assertDay(frequency, day);
      doc.frequency = frequency;
      doc.day = day;
      // a changed schedule starts from the next matching date
      doc.next_run = nextDate(new Date(), frequency, day);
    }

    await doc.save();
    return doc;
  }

  async findAll(officeId?: string): Promise<RecurringRow[]> {
    const filter: Record<string, any> = { deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const docs = await this.recurringModel
      .find(filter)
      .sort({ active: -1, next_run: 1 })
      .exec();
    return docs.map((d) => this.toRow(d));
  }

  async findOne(id: string): Promise<RecurringExpenseDocument> {
    this.assertObjectId(id);
    const doc = await this.recurringModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!doc) throw new NotFoundException(`Recurring expense ${id} not found`);
    return doc;
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const doc = await this.findOne(id);
    doc.deleted_at = new Date();
    await doc.save();
    return { id: doc._id.toString(), deleted: true };
  }

  // ---------- writing the bills that fell due ----------

  /**
   * Writes an expense for every instruction whose date has passed, and moves
   * the date on. Called whenever the expense screens are read, which is what
   * makes it work without a scheduler: the shop sees the bill the first time
   * anyone opens the app on or after the day it was due.
   *
   * Each instruction is claimed with a conditional update on `next_run`, so
   * two requests arriving together cannot both write the same bill — and a
   * run that is days late backfills each missed date rather than collapsing
   * them into one.
   */
  async materialiseDue(officeId?: string): Promise<number> {
    const now = new Date();
    const filter: Record<string, any> = {
      deleted_at: null,
      active: true,
      next_run: { $lte: now },
    };
    if (officeId && isValidObjectId(officeId)) {
      filter.office_id = new Types.ObjectId(officeId);
    }

    const due = await this.recurringModel.find(filter).limit(50).exec();
    let written = 0;

    for (const rule of due) {
      // backfill, but never more than a year of missed dates in one go
      let guard = 0;
      while (rule.next_run <= now && guard++ < 60) {
        const dueDate = new Date(rule.next_run);
        const following = nextDate(dueDate, rule.frequency, rule.day);

        // claim this date: only the caller that moves next_run writes the bill
        const claimed = await this.recurringModel
          .findOneAndUpdate(
            { _id: rule._id, next_run: rule.next_run },
            { $set: { next_run: following, last_run: dueDate } },
            { returnDocument: 'after' },
          )
          .exec();
        if (!claimed) break; // someone else took it

        await this.expenseModel.create({
          expense_no: await this.nextExpenseNo(rule.office_id.toString()),
          office_id: rule.office_id,
          category: rule.category,
          amount: rule.amount,
          payment_method: rule.payment_method,
          spent_at: dueDate,
          paid_to: rule.paid_to,
          note: rule.note,
          created_by: rule.created_by ?? null,
        });
        written++;
        rule.next_run = claimed.next_run;
      }
    }

    return written;
  }

  // ---------- helpers ----------

  private toRow(doc: RecurringExpenseDocument): RecurringRow {
    return {
      id: doc._id.toString(),
      office_id: doc.office_id.toString(),
      category: doc.category,
      amount: doc.amount,
      payment_method: doc.payment_method,
      paid_to: doc.paid_to ?? '',
      note: doc.note ?? '',
      frequency: doc.frequency,
      day: doc.day,
      next_run: doc.next_run ? doc.next_run.toISOString() : null,
      last_run: doc.last_run ? doc.last_run.toISOString() : null,
      active: doc.active,
    };
  }

  private assertDay(frequency: RecurringFrequency, day: number) {
    const max = frequency === RecurringFrequency.WEEKLY ? 6 : 31;
    const min = frequency === RecurringFrequency.WEEKLY ? 0 : 1;
    if (day < min || day > max) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          day: [
            frequency === RecurringFrequency.WEEKLY
              ? 'day must be 0 (Sunday) to 6 (Saturday)'
              : 'day must be 1 to 31',
          ],
        },
      });
    }
  }

  private async nextExpenseNo(officeId: string): Promise<string> {
    const seq = await this.counters.next(`expense:${officeId}`);
    return `EXP-${String(seq).padStart(4, '0')}`;
  }

  private async office(id: string): Promise<OfficeDocument> {
    this.assertObjectId(id, 'office_id');
    const office = await this.officeModel
      .findOne({ _id: id, deleted_at: null })
      .exec();
    if (!office) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['office does not exist'] },
      });
    }
    return office;
  }

  private assertObjectId(id: string, field = 'id') {
    if (!isValidObjectId(id)) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { [field]: [`${field} must be a valid id`] },
      });
    }
  }

  private toObjectIdOrNull(id?: string): Types.ObjectId | null {
    return id && isValidObjectId(id) ? new Types.ObjectId(id) : null;
  }
}

/**
 * The next time after `from` that the schedule falls due.
 *
 * A monthly rule asking for the 31st lands on the last day of a short month
 * rather than skipping February altogether — the rent is still due.
 */
function nextDate(from: Date, frequency: RecurringFrequency, day: number): Date {
  const base = new Date(from);
  base.setHours(9, 0, 0, 0); // mid-morning, so a timezone shift cannot move the day

  if (frequency === RecurringFrequency.WEEKLY) {
    const ahead = (day - base.getDay() + 7) % 7 || 7;
    const next = new Date(base);
    next.setDate(base.getDate() + ahead);
    return next;
  }

  const candidate = monthlyDate(base.getFullYear(), base.getMonth(), day, base);
  if (candidate > from) return candidate;
  return monthlyDate(base.getFullYear(), base.getMonth() + 1, day, base);
}

function monthlyDate(year: number, month: number, day: number, base: Date): Date {
  // day 0 of the next month is the last day of this one
  const lastDay = new Date(year, month + 1, 0).getDate();
  const next = new Date(base);
  next.setFullYear(year, month, Math.min(day, lastDay));
  return next;
}
