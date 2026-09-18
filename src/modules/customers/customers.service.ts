import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { StorageService } from '../../common/storage/storage.service';
import { Office, OfficeDocument } from '../office/schemas/office.schema';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomerDto, SortOrder } from './dto/query-customer.dto';
import { ReceivePaymentDto } from './dto/receive-payment.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  CustomerPayment,
  CustomerPaymentDocument,
} from './schemas/customer-payment.schema';
import { Customer, CustomerDocument } from './schemas/customer.schema';

// columns loaded for the list grid (full_name built from first/last)
const LIST_FIELDS =
  'first_name last_name customer_status mobile_no email borrow_amount';

export interface CustomerListRow {
  id: string;
  full_name: string;
  customer_status: string;
  mobile_no: string;
  email: string | null;
  /** running unpaid balance across borrowed sales */
  borrow_amount: number;
}

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
    @InjectModel(Office.name)
    private readonly officeModel: Model<OfficeDocument>,
    @InjectModel(CustomerPayment.name)
    private readonly paymentModel: Model<CustomerPaymentDocument>,
    private readonly fileStorage: StorageService,
  ) {}

  async create(dto: CreateCustomerDto): Promise<CustomerDocument> {
    await this.assertOfficeExists(dto.office_id);
    await this.assertEmailUnique(dto.office_id, dto.email);
    await this.assertCnicUnique(dto.office_id, dto.cnic_no);

    const { profile_photo, ...rest } = dto;
    const payload: Record<string, any> = {
      ...rest,
      office_id: new Types.ObjectId(dto.office_id),
    };
    if (profile_photo && profile_photo.trim()) {
      payload.profile_photo = this.fileStorage.saveBase64Image(profile_photo, {
        folder: 'customers',
        field: 'profile_photo',
      });
    }

    try {
      return await this.customerModel.create(payload);
    } catch (e) {
      this.rethrowDuplicate(e);
    }
  }

  async findAll(query: QueryCustomerDto): Promise<{
    data: CustomerListRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, search, office_id, customer_status, sort, order } =
      query;

    const filter: Record<string, any> = { deleted_at: null };
    if (office_id) {
      filter.office_id = new Types.ObjectId(office_id);
    }
    if (customer_status) {
      filter.customer_status = customer_status;
    }
    if (search?.trim()) {
      const rx = new RegExp(this.escapeRegex(search.trim()), 'i');
      filter.$or = [
        { first_name: rx },
        { last_name: rx },
        { email: rx },
        { mobile_no: rx },
        { cnic_no: rx },
      ];
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sort]: order === SortOrder.ASC ? 1 : -1,
    };

    const [docs, total] = await Promise.all([
      this.customerModel
        .find(filter)
        .select(LIST_FIELDS)
        .sort(sortSpec)
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.customerModel.countDocuments(filter).exec(),
    ]);

    const data: CustomerListRow[] = docs.map((d) => ({
      id: d._id.toString(),
      full_name: `${d.first_name} ${d.last_name}`.trim(),
      customer_status: d.customer_status,
      mobile_no: d.mobile_no,
      email: d.email ?? null,
      borrow_amount: d.borrow_amount ?? 0,
    }));

    return { data, total, page, limit };
  }

  async findOne(id: string, officeId?: string): Promise<CustomerDocument> {
    this.assertObjectId(id);
    const filter: Record<string, any> = { _id: id, deleted_at: null };
    if (officeId) {
      this.assertObjectId(officeId, 'office_id');
      filter.office_id = new Types.ObjectId(officeId);
    }
    const doc = await this.customerModel.findOne(filter).exec();
    if (!doc) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return doc;
  }

  // PUT — full update
  async update(id: string, dto: UpdateCustomerDto): Promise<CustomerDocument> {
    return this.applyUpdate(id, dto);
  }

  // PATCH — partial update (main use: toggle customer_status)
  async patch(id: string, dto: UpdateCustomerDto): Promise<CustomerDocument> {
    return this.applyUpdate(id, dto);
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    this.assertObjectId(id);
    const res = await this.customerModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    if (!res) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return { id, deleted: true };
  }

  async bulkRemove(dto: BulkDeleteDto): Promise<{ deleted_count: number }> {
    const res = await this.customerModel
      .updateMany(
        { _id: { $in: dto.ids }, deleted_at: null },
        { deleted_at: new Date() },
      )
      .exec();
    return { deleted_count: res.modifiedCount };
  }

  // --- used by the sales module ---

  /**
   * Find the office's customer by mobile number, or create one from what the
   * cashier typed. Lets a borrowed walk-in sale build the customer book
   * without a separate trip to the customer form.
   */
  async findOrCreateForSale(
    officeId: string,
    input: { name?: string; mobile_no: string },
  ): Promise<CustomerDocument> {
    this.assertObjectId(officeId, 'office_id');
    const mobile = input.mobile_no.trim();
    if (!mobile) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { customer_mobile: ['mobile no is required to borrow'] },
      });
    }

    const existing = await this.customerModel
      .findOne({
        office_id: new Types.ObjectId(officeId),
        mobile_no: mobile,
        deleted_at: null,
      })
      .exec();
    if (existing) return existing;

    // "Ali Hassan" -> first "Ali", last "Hassan"; a single word keeps last blank
    const [first, ...rest] = (input.name ?? '').trim().split(/\s+/);
    return this.customerModel.create({
      office_id: new Types.ObjectId(officeId),
      first_name: first || 'Walk-in',
      last_name: rest.join(' '),
      mobile_no: mobile,
    });
  }

  /**
   * Customer paid something towards their borrow. The decrement is guarded in
   * the same query (`borrow_amount >= amount`) so two cashiers can't both take
   * the same balance below zero.
   */
  async receivePayment(
    id: string,
    dto: ReceivePaymentDto,
    userId?: string,
  ): Promise<{ customer: CustomerDocument; payment: CustomerPaymentDocument }> {
    this.assertObjectId(id);
    const amount = round2(dto.amount);

    const updated = await this.customerModel
      .findOneAndUpdate(
        { _id: id, deleted_at: null, borrow_amount: { $gte: amount } },
        { $inc: { borrow_amount: -amount } },
        { new: true },
      )
      .exec();

    if (!updated) {
      // tell apart "no such customer" from "paying more than they owe"
      const existing = await this.findOne(id);
      throw new BadRequestException({
        message: 'Validation failed',
        errors: {
          amount: [
            `payment cannot exceed the borrow balance of ${round2(existing.borrow_amount ?? 0)}`,
          ],
        },
      });
    }

    // float drift from repeated $inc — pin to cents
    updated.borrow_amount = round2(updated.borrow_amount);
    await updated.save();

    const payment = await this.paymentModel.create({
      office_id: updated.office_id,
      customer_id: updated._id,
      amount,
      balance_after: updated.borrow_amount,
      note: dto.note,
      received_by: userId && isValidObjectId(userId)
        ? new Types.ObjectId(userId)
        : null,
    });

    return { customer: updated, payment };
  }

  /** Move a customer's unpaid balance by `delta` (never below zero). */
  async adjustBorrow(customerId: Types.ObjectId, delta: number): Promise<void> {
    if (!delta) return;
    const customer = await this.customerModel.findById(customerId).exec();
    if (!customer) return;
    customer.borrow_amount = Math.max(
      0,
      round2((customer.borrow_amount ?? 0) + delta),
    );
    await customer.save();
  }

  // --- helpers ---

  private async applyUpdate(
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerDocument> {
    const doc = await this.findOne(id);
    const officeId = doc.office_id.toString();

    // a customer belongs to the office they were created in
    if (dto.office_id && dto.office_id !== officeId) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: { office_id: ['a customer cannot be moved to another office'] },
      });
    }

    if (dto.email !== undefined && dto.email !== doc.email) {
      await this.assertEmailUnique(officeId, dto.email, id);
    }
    if (dto.cnic_no !== undefined && dto.cnic_no !== doc.cnic_no) {
      await this.assertCnicUnique(officeId, dto.cnic_no, id);
    }

    const { profile_photo, office_id: _ignored, ...rest } = dto;
    Object.assign(doc, rest);

    // empty/null photo => keep existing; new base64 => replace
    if (profile_photo && profile_photo.trim()) {
      doc.profile_photo = this.fileStorage.saveBase64Image(profile_photo, {
        folder: 'customers',
        field: 'profile_photo',
      });
    }

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

  /** Blank email is always fine; a given one must be free inside the office. */
  private async assertEmailUnique(
    officeId: string,
    email: string | null | undefined,
    excludeId?: string,
  ) {
    if (!email) return;
    const filter: Record<string, any> = {
      office_id: new Types.ObjectId(officeId),
      email: email.toLowerCase(),
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.customerModel.exists(filter)) {
      throw new ConflictException('email already exists in this office');
    }
  }

  private async assertCnicUnique(
    officeId: string,
    cnic: string | null | undefined,
    excludeId?: string,
  ) {
    if (!cnic) return;
    const filter: Record<string, any> = {
      office_id: new Types.ObjectId(officeId),
      cnic_no: cnic,
      deleted_at: null,
    };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }
    if (await this.customerModel.exists(filter)) {
      throw new ConflictException('cnic_no already exists in this office');
    }
  }

  private assertObjectId(id: string, field = 'id') {
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid ${field} "${id}"`);
    }
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // duplicate-key (race with the unique index) -> 409 naming the field
  private rethrowDuplicate(e: unknown): never {
    if (isDuplicateKeyError(e)) {
      const key = Object.keys(e.keyPattern ?? {}).find((k) => k !== 'office_id');
      throw new ConflictException(
        key ? `${key} already exists in this office` : 'duplicate key',
      );
    }
    throw e;
  }
}

interface DuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isDuplicateKeyError(e: unknown): e is DuplicateKeyError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: number }).code === 11000
  );
}
