import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { PaySupplierDto } from './dto/pay-supplier.dto';
import { QuerySupplierDto, SortOrder } from './dto/query-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import {
  SupplierPayment,
  SupplierPaymentDocument,
} from './schemas/supplier-payment.schema';
import { Supplier, SupplierDocument } from './schemas/supplier.schema';

const LIST_FIELDS = 'name company mobile_no email payable_amount status';

export interface SupplierListRow {
  id: string;
  name: string;
  company: string;
  mobile_no: string;
  email: string | null;
  payable_amount: number;
  status: string;
}

@Injectable()
export class SuppliersService {
  constructor(
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
    @InjectModel(SupplierPayment.name)
    private readonly paymentModel: Model<SupplierPaymentDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
  ) {}

  async create(dto: CreateSupplierDto): Promise<SupplierDocument> {
    await this.assertOfficeExists(dto.office_id);
    try {
      return await this.supplierModel.create({
        ...dto,
        office_id: new Types.ObjectId(dto.office_id),
      });
    } catch (e) {
      this.rethrowDuplicate(e);
    }
  }

  async findAll(query: QuerySupplierDto): Promise<{
    data: SupplierListRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, office_id, status, sort, order } = query;

    const filter: Record<string, any> = { deleted_at: null };
    if (office_id) filter.office_id = new Types.ObjectId(office_id);
    if (status) filter.status = status;
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [{ name: rx }, { company: rx }, { mobile_no: rx }];
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.supplierModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.supplierModel.countDocuments(filter).exec(),
    ]);

    const data: SupplierListRow[] = docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      company: d.company ?? '',
      mobile_no: d.mobile_no,
      email: d.email ?? null,
      payable_amount: d.payable_amount ?? 0,
      status: d.status,
    }));

    return { data, total, page, limit };
  }

  async findOne(id: string, officeId?: string): Promise<SupplierDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.supplierModel.findOne(filter).exec();
    if (!doc) throw new NotFoundException(`Supplier ${id} not found`);
    return doc;
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierDocument> {
    return this.applyUpdate(id, dto);
  }

  async patch(id: string, dto: UpdateSupplierDto): Promise<SupplierDocument> {
    return this.applyUpdate(id, dto);
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    const supplier = await this.findOne(id);
    // a balance is money owed — deleting it would silently wipe the debt
    if ((supplier.payable_amount ?? 0) > 0) {
      throw new ConflictException(
        `"${supplier.name}" still has ${supplier.payable_amount} payable — settle it first`,
      );
    }
    supplier.deleted_at = new Date();
    await supplier.save();
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const suppliers = await this.supplierModel
      .find({ _id: { $in: dto.ids }, deleted_at: null })
      .exec();
    const owing = suppliers.filter((s) => (s.payable_amount ?? 0) > 0);
    if (owing.length) {
      throw new ConflictException(
        `${owing.length} supplier(s) still have a payable balance: ${owing
          .map((s) => s.name)
          .slice(0, 5)
          .join(', ')}`,
      );
    }
    const res = await this.supplierModel
      .updateMany(
        { _id: { $in: dto.ids }, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    return { deleted_count: res.modifiedCount };
  }

  // ---------- payments ----------

  /**
   * Pay a supplier. The decrement is guarded in the same query, so two staff
   * paying at once cannot push the balance below zero.
   */
  async pay(
    id: string,
    dto: PaySupplierDto,
    userId?: string,
  ): Promise<{ supplier: SupplierDocument; payment: SupplierPaymentDocument }> {
    this.assertObjectId(id);
    const amount = round2(dto.amount);

    const updated = await this.supplierModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null, payable_amount: { $gte: amount } },
        { $inc: { payable_amount: -amount } },
        { new: true },
      )
      .exec();

    if (!updated) {
      const existing = await this.findOne(id);
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          amount: [
            `payment cannot exceed the payable balance of ${round2(existing.payable_amount ?? 0)}`,
          ],
        },
      });
    }

    updated.payable_amount = round2(updated.payable_amount);
    await updated.save();

    const payment = await this.paymentModel.create({
      office_id: updated.office_id,
      supplier_id: updated._id,
      amount,
      balance_after: updated.payable_amount,
      note: dto.note,
      paid_by: this.toObjectIdOrNull(userId),
    });

    return { supplier: updated, payment };
  }

  // ---------- used by the purchases module ----------

  /** Move a supplier's payable by `delta` (never below zero). */
  async adjustPayable(
    supplierId: Types.ObjectId,
    delta: number,
  ): Promise<void> {
    if (!delta) return;
    const supplier = await this.supplierModel.findById(supplierId).exec();
    if (!supplier) return;
    supplier.payable_amount = Math.max(
      0,
      round2((supplier.payable_amount ?? 0) + delta),
    );
    await supplier.save();
  }

  // ---------- helpers ----------

  private async applyUpdate(
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierDocument> {
    const doc = await this.findOne(id);
    if (dto.office_id && dto.office_id !== doc.office_id.toString()) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['a supplier cannot be moved to another office'] },
      });
    }
    const { office_id: _ignored, ...rest } = dto;
    Object.assign(doc, rest);
    try {
      return await doc.save();
    } catch (e) {
      this.rethrowDuplicate(e);
    }
  }

  private async assertOfficeExists(officeId: string) {
    this.assertObjectId(officeId, 'office_id');
    const exists = await this.officeModel.exists({
      _id: officeId,
      deleted_at: null,
    });
    if (!exists) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['office does not exist'] },
      });
    }
  }

  private assertObjectId(id: string, field = 'id') {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ${field} "${id}"`);
    }
  }

  private toObjectIdOrNull(id?: string): Types.ObjectId | null {
    return id && isValidObjectId(id) ? new Types.ObjectId(id) : null;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private rethrowDuplicate(e: unknown): never {
    if (
      typeof e === 'object' &&
      e !== null &&
      (e as { code?: number }).code === 11000
    ) {
      throw new ConflictException('mobile_no already exists in this office');
    }
    throw e;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
