import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  Customer,
  CustomerDocument,
} from '../../modules/customers/schemas/customer.schema';
import { Rack, RackDocument } from '../../modules/locations/schemas/rack.schema';
import { Office, OfficeDocument } from '../../modules/office/schemas/office.schema';
import {
  Product,
  ProductDocument,
} from '../../modules/products/schemas/product.schema';
import { Staff, StaffDocument } from '../../modules/staff/schemas/staff.schema';
import {
  Supplier,
  SupplierDocument,
} from '../../modules/suppliers/schemas/supplier.schema';

/**
 * What the trash can hold. Only records that carry no ledger of their own:
 * a deleted sale or purchase already gave its stock and money back when it
 * was removed, so bringing the document back would double-count. Those are
 * reversed, never restored — which is why they are not listed here.
 */
export const TRASH_MODULES = [
  'products',
  'customer',
  'supplier',
  'staff',
  'office',
  'location',
] as const;

export type TrashModule = (typeof TRASH_MODULES)[number];

export interface TrashRow {
  id: string;
  module: TrashModule;
  module_label: string;
  label: string;
  sub_label: string;
  office_id: string | null;
  deleted_at: string | null;
}

export interface TrashQuery {
  page: number;
  limit: number;
  module?: TrashModule;
  office_id?: string;
  search?: string;
}

/** How one kind of record is read out of the bin and put back. */
interface TrashSpec {
  key: TrashModule;
  label: string;
  model: Model<any>;
  /** fields a search should match */
  searchFields: string[];
  /** builds the row's display text */
  row: (doc: Record<string, any>) => { label: string; sub_label: string };
  /** true when the record is office-scoped (offices themselves are not) */
  officeScoped: boolean;
  /**
   * What would clash if this came back — the live record holding the same
   * unique value. Restoring is refused rather than throwing a raw duplicate
   * key error at the user.
   */
  clash?: (doc: Record<string, any>) => Record<string, any>;
  clashMessage?: (doc: Record<string, any>) => string;
}

@Injectable()
export class TrashService {
  private readonly specs: TrashSpec[];

  constructor(
    @InjectModel(Product.name) productModel: Model<ProductDocument>,
    @InjectModel(Customer.name) customerModel: Model<CustomerDocument>,
    @InjectModel(Supplier.name) supplierModel: Model<SupplierDocument>,
    @InjectModel(Staff.name) staffModel: Model<StaffDocument>,
    @InjectModel(Office.name) officeModel: Model<OfficeDocument>,
    @InjectModel(Rack.name) rackModel: Model<RackDocument>,
  ) {
    this.specs = [
      {
        key: 'products',
        label: 'Product',
        model: productModel,
        searchFields: ['name', 'sku', 'barcode'],
        row: (d) => ({ label: d.name, sub_label: d.sku ?? '' }),
        officeScoped: true,
        clash: (d) => ({ office_id: d.office_id, sku: d.sku, deleted_at: null }),
        clashMessage: (d) =>
          `another live product already uses the SKU "${d.sku}" in this office`,
      },
      {
        key: 'customer',
        label: 'Customer',
        model: customerModel,
        searchFields: ['first_name', 'last_name', 'mobile_no', 'email'],
        row: (d) => ({
          label: `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(),
          sub_label: d.mobile_no ?? '',
        }),
        officeScoped: true,
        clash: (d) => ({
          office_id: d.office_id,
          mobile_no: d.mobile_no,
          deleted_at: null,
        }),
        clashMessage: (d) =>
          `another live customer already uses the mobile no ${d.mobile_no}`,
      },
      {
        key: 'supplier',
        label: 'Supplier',
        model: supplierModel,
        searchFields: ['name', 'company', 'mobile_no'],
        row: (d) => ({ label: d.name, sub_label: d.company || d.mobile_no || '' }),
        officeScoped: true,
        clash: (d) => ({
          office_id: d.office_id,
          mobile_no: d.mobile_no,
          deleted_at: null,
        }),
        clashMessage: (d) =>
          `another live supplier already uses the mobile no ${d.mobile_no}`,
      },
      {
        key: 'staff',
        label: 'Staff',
        model: staffModel,
        searchFields: ['first_name', 'last_name', 'email', 'mobile_no'],
        row: (d) => ({
          label: `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim(),
          sub_label: d.email ?? '',
        }),
        officeScoped: false, // staff belong to many offices at once
        clash: (d) => ({ email: d.email, deleted_at: null }),
        clashMessage: (d) => `another live user already uses ${d.email}`,
      },
      {
        key: 'office',
        label: 'Office',
        model: officeModel,
        searchFields: ['office_name', 'office_email', 'office_mobile_no'],
        row: (d) => ({ label: d.office_name, sub_label: d.office_email ?? '' }),
        officeScoped: false,
        clash: (d) => ({ office_email: d.office_email, deleted_at: null }),
        clashMessage: (d) =>
          `another live office already uses ${d.office_email}`,
      },
      {
        key: 'location',
        label: 'Rack',
        model: rackModel,
        searchFields: ['name', 'code'],
        row: (d) => ({ label: d.name, sub_label: d.code ?? '' }),
        officeScoped: true,
      },
    ];
  }

  // ---------- read ----------

  async findAll(query: TrashQuery): Promise<{
    data: TrashRow[];
    total: number;
    page: number;
    limit: number;
    counts: Record<string, number>;
  }> {
    const specs = query.module
      ? this.specs.filter((s) => s.key === query.module)
      : this.specs;

    // each kind is its own collection, so the page is assembled in memory:
    // a bin holds tens of records, not thousands
    const found: { row: TrashRow; deleted: number }[] = [];
    const counts: Record<string, number> = {};

    for (const spec of specs) {
      const filter = this.filterFor(spec, query);
      const docs = await spec.model
        .find(filter)
        .sort({ deleted_at: -1 })
        .limit(500)
        .lean()
        .exec();
      counts[spec.key] = docs.length;
      for (const doc of docs) {
        const { label, sub_label } = spec.row(doc);
        found.push({
          row: {
            id: String(doc._id),
            module: spec.key,
            module_label: spec.label,
            label: label || '(no name)',
            sub_label,
            office_id: doc.office_id ? String(doc.office_id) : null,
            deleted_at: doc.deleted_at
              ? new Date(doc.deleted_at).toISOString()
              : null,
          },
          deleted: doc.deleted_at ? new Date(doc.deleted_at).getTime() : 0,
        });
      }
    }

    found.sort((a, b) => b.deleted - a.deleted);
    const total = found.length;
    const start = (query.page - 1) * query.limit;
    return {
      data: found.slice(start, start + query.limit).map((f) => f.row),
      total,
      page: query.page,
      limit: query.limit,
      counts,
    };
  }

  // ---------- restore ----------

  /** Put a record back, unless a live one has taken its unique spot. */
  async restore(
    module: string,
    id: string,
  ): Promise<{ id: string; module: string; restored: true; label: string }> {
    const spec = this.spec(module);
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid id "${id}"`);
    }

    const doc = await spec.model
      .findOne({ _id: id, deleted_at: { $ne: null } })
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException('That record is not in the trash');
    }

    if (spec.clash) {
      const taken = await spec.model.exists(spec.clash(doc));
      if (taken) {
        throw new ConflictException(
          spec.clashMessage?.(doc) ?? 'a live record already holds that value',
        );
      }
    }

    await spec.model.updateOne({ _id: id }, { $set: { deleted_at: null } }).exec();
    return {
      id,
      module: spec.key,
      restored: true,
      label: spec.row(doc).label,
    };
  }

  /** Remove it for good. There is nothing after this. */
  async purge(module: string, id: string): Promise<{ id: string; purged: true }> {
    const spec = this.spec(module);
    if (!isValidObjectId(id)) {
      throw new BadRequestException(`Invalid id "${id}"`);
    }
    const res = await spec.model
      .deleteOne({ _id: id, deleted_at: { $ne: null } })
      .exec();
    if (!res.deletedCount) {
      throw new NotFoundException('That record is not in the trash');
    }
    return { id, purged: true };
  }

  // ---------- helpers ----------

  private spec(module: string): TrashSpec {
    const spec = this.specs.find((s) => s.key === module);
    if (!spec) {
      throw new BadRequestException(
        `"${module}" cannot be restored. Sales, purchases and stock moves are reversed instead, which puts the stock and money back.`,
      );
    }
    return spec;
  }

  private filterFor(spec: TrashSpec, query: TrashQuery): Record<string, any> {
    const filter: Record<string, any> = { deleted_at: { $ne: null } };
    if (spec.officeScoped && query.office_id) {
      filter.office_id = new Types.ObjectId(query.office_id);
    }
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = spec.searchFields.map((f) => ({ [f]: rx }));
    }
    return filter;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
