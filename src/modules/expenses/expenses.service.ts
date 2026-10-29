import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { CountersService } from '../../common/counters/counters.service';
import { StorageService } from '../../common/storage/storage.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import {
  CreateExpenseDto,
  QueryExpenseDto,
  SortOrder,
  UpdateExpenseDto,
} from './dto/expense.dto';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  Expense,
  ExpenseDocument,
  ExpensePaymentMethod,
} from './schemas/expense.schema';

export interface ExpenseRow {
  id: string;
  expense_no: string;
  office_id: string;
  category: string;
  amount: number;
  payment_method: ExpensePaymentMethod;
  spent_at: string | null;
  paid_to: string;
  note: string;
  /** the photographed bill, when there is one */
  receipt: string | null;
  created_at: string | null;
}

export interface ExpenseSummary {
  entries: number;
  total: number;
  /** cash is the only part that came out of the till */
  cash: number;
  online: number;
  by_category: { category: string; amount: number; entries: number }[];
}

const SORTABLE = ['expense_no', 'category', 'amount', 'spent_at', 'created_at'];

@Injectable()
export class ExpensesService {
  constructor(
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    private readonly counters: CountersService,
    private readonly fileStorage: StorageService,
  ) {}

  // ---------- create / update ----------

  async create(dto: CreateExpenseDto, userId?: string): Promise<ExpenseDocument> {
    const office = await this.office(dto.office_id);
    return this.expenseModel.create({
      expense_no: await this.nextExpenseNo(office._id.toString()),
      office_id: office._id,
      category: dto.category.trim(),
      amount: dto.amount,
      payment_method: dto.payment_method ?? ExpensePaymentMethod.CASH,
      spent_at: dto.spent_at ? new Date(dto.spent_at) : new Date(),
      paid_to: dto.paid_to?.trim() ?? '',
      note: dto.note?.trim() ?? '',
      receipt: this.storeReceipt(dto.receipt),
      created_by: this.toObjectIdOrNull(userId),
    });
  }

  async update(id: string, dto: UpdateExpenseDto): Promise<ExpenseDocument> {
    const doc = await this.findOne(id);
    if (dto.office_id) {
      // moving an expense to another branch moves the money with it
      const office = await this.office(dto.office_id);
      doc.office_id = office._id;
    }
    if (dto.category !== undefined) doc.category = dto.category.trim();
    if (dto.amount !== undefined) doc.amount = dto.amount;
    if (dto.payment_method !== undefined) doc.payment_method = dto.payment_method;
    if (dto.spent_at !== undefined) doc.spent_at = new Date(dto.spent_at);
    if (dto.paid_to !== undefined) doc.paid_to = dto.paid_to.trim();
    if (dto.note !== undefined) doc.note = dto.note.trim();
    if (dto.receipt !== undefined) {
      // empty string clears the photo; a data URL replaces it; a stored URL
      // coming back unchanged is left alone
      doc.receipt = dto.receipt ? this.storeReceipt(dto.receipt) : null;
    }
    await doc.save();
    return doc;
  }

  /** A data URL becomes a file; anything else is already a stored path. */
  private storeReceipt(value?: string | null): string | null {
    const receipt = value?.trim();
    if (!receipt) return null;
    if (!receipt.startsWith('data:')) return receipt;
    return this.fileStorage.saveBase64Image(receipt, {
      folder: 'expenses',
      field: 'receipt',
    });
  }

  // ---------- read ----------

  async findAll(query: QueryExpenseDto): Promise<{
    data: ExpenseRow[];
    total: number;
    page: number;
    limit: number;
    summary: ExpenseSummary;
  }> {
    const { page, limit, sort, order } = query;
    const filter = this.buildFilter(query);
    const sortField = SORTABLE.includes(sort) ? sort : 'spent_at';
    const sortSpec: Record<string, 1 | -1> = {
      [sortField]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total, totals, byCategory] = await Promise.all([
      this.expenseModel
        .find(filter)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.expenseModel.countDocuments(filter).exec(),
      this.expenseModel
        .aggregate<{ total: number; cash: number; online: number }>([
          { $match: filter },
          {
            $group: {
              _id: null,
              total: { $sum: '$amount' },
              cash: {
                $sum: {
                  $cond: [
                    { $eq: ['$payment_method', ExpensePaymentMethod.CASH] },
                    '$amount',
                    0,
                  ],
                },
              },
              online: {
                $sum: {
                  $cond: [
                    { $eq: ['$payment_method', ExpensePaymentMethod.ONLINE] },
                    '$amount',
                    0,
                  ],
                },
              },
            },
          },
        ])
        .exec(),
      this.expenseModel
        .aggregate<{ _id: string; amount: number; entries: number }>([
          { $match: filter },
          {
            $group: {
              _id: '$category',
              amount: { $sum: '$amount' },
              entries: { $sum: 1 },
            },
          },
          { $sort: { amount: -1 } },
        ])
        .exec(),
    ]);

    return {
      data: docs.map((d) => this.toRow(d)),
      total,
      page,
      limit,
      summary: {
        entries: total,
        total: round2(totals[0]?.total ?? 0),
        cash: round2(totals[0]?.cash ?? 0),
        online: round2(totals[0]?.online ?? 0),
        by_category: byCategory.map((c) => ({
          category: c._id,
          amount: round2(c.amount),
          entries: c.entries,
        })),
      },
    };
  }

  async findOne(id: string, officeId?: string): Promise<ExpenseDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.expenseModel.findOne(filter).exec();
    if (!doc) throw new NotFoundException(`Expense ${id} not found`);
    return doc;
  }

  /**
   * The picker: the starter list plus whatever this branch has actually used,
   * so a shop's own wording comes back without anyone maintaining a list.
   */
  async categories(officeId?: string): Promise<string[]> {
    const filter: Record<string, any> = { deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const used = (await this.expenseModel
      .distinct('category', filter)
      .exec()) as string[];

    const seen = new Map<string, string>();
    for (const name of [...DEFAULT_EXPENSE_CATEGORIES, ...used]) {
      const key = name.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, name.trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  // ---------- delete ----------

  /** Soft delete, like everything else — it lands in the trash. */
  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const doc = await this.findOne(id);
    doc.deleted_at = new Date();
    await doc.save();
    return { id: doc._id.toString(), deleted: true };
  }

  // ---------- helpers ----------

  private buildFilter(query: QueryExpenseDto): Record<string, any> {
    const filter: Record<string, any> = { deleted_at: null };
    if (query.office_id) {
      filter.office_id = new Types.ObjectId(query.office_id);
    }
    if (query.category) filter.category = query.category;
    if (query.payment_method) filter.payment_method = query.payment_method;

    const range = this.dateRange(query.date_from, query.date_to);
    if (range) filter.spent_at = range;

    const search = query.search?.trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { expense_no: rx },
        { category: rx },
        { paid_to: rx },
        { note: rx },
      ];
    }
    return filter;
  }

  private dateRange(from?: string, to?: string): Record<string, Date> | null {
    if (!from && !to) return null;
    const range: Record<string, Date> = {};
    if (from) range.$gte = new Date(from);
    if (to) range.$lte = new Date(to);
    return range;
  }

  private toRow(doc: ExpenseDocument): ExpenseRow {
    const json = doc.toJSON() as { created_at?: string };
    return {
      id: doc._id.toString(),
      expense_no: doc.expense_no,
      office_id: doc.office_id.toString(),
      category: doc.category,
      amount: round2(doc.amount),
      payment_method: doc.payment_method,
      spent_at: doc.spent_at ? doc.spent_at.toISOString() : null,
      paid_to: doc.paid_to ?? '',
      note: doc.note ?? '',
      receipt: doc.receipt ?? null,
      created_at: json.created_at ?? null,
    };
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
