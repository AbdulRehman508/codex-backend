import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Staff, StaffDocument } from '../../modules/staff/schemas/staff.schema';
import { AuditAction, AuditLog, AuditLogDocument } from './audit-log.schema';

export interface AuditEntry {
  office_id?: string | null;
  user_id?: string | null;
  user_email?: string;
  module: string;
  action: AuditAction;
  entity_id?: string;
  entity_label?: string;
  method: string;
  path: string;
  status_code: number;
  ip?: string;
}

export interface AuditQuery {
  page: number;
  limit: number;
  office_id?: string;
  user_id?: string;
  module?: string;
  action?: AuditAction;
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface AuditRow {
  id: string;
  created_at: string | null;
  user_name: string;
  user_email: string;
  module: string;
  action: string;
  entity_label: string;
  entity_id: string;
  method: string;
  path: string;
  status_code: number;
  ip: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  /** id -> display name, so a busy shop does not re-query the same staff */
  private readonly nameCache = new Map<string, string>();

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(Staff.name)
    private readonly staffModel: Model<StaffDocument>,
  ) {}

  /** Fire-and-forget: a failed audit write never breaks the user's action. */
  record(entry: AuditEntry): void {
    void this.write(entry).catch((err) =>
      this.logger.warn(`audit write failed: ${(err as Error).message}`),
    );
  }

  private async write(entry: AuditEntry): Promise<void> {
    const user_name = entry.user_id ? await this.nameFor(entry.user_id) : '';
    await this.auditModel.create({
      office_id: this.toObjectIdOrNull(entry.office_id),
      user_id: this.toObjectIdOrNull(entry.user_id),
      user_name,
      user_email: entry.user_email ?? '',
      module: entry.module,
      action: entry.action,
      entity_id: entry.entity_id ?? '',
      entity_label: (entry.entity_label ?? '').slice(0, 120),
      method: entry.method,
      path: entry.path.slice(0, 200),
      status_code: entry.status_code,
      ip: entry.ip ?? '',
    });
  }

  private async nameFor(userId: string): Promise<string> {
    const hit = this.nameCache.get(userId);
    if (hit !== undefined) return hit;
    if (!isValidObjectId(userId)) return '';
    const staff = await this.staffModel
      .findById(userId)
      .select('first_name last_name')
      .lean()
      .exec();
    const name = staff
      ? `${staff.first_name ?? ''} ${staff.last_name ?? ''}`.trim()
      : '';
    this.nameCache.set(userId, name);
    return name;
  }

  // ---------- read ----------

  async findAll(query: AuditQuery): Promise<{
    data: AuditRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit } = query;
    const filter: Record<string, any> = {};
    if (query.office_id) filter.office_id = new Types.ObjectId(query.office_id);
    if (query.user_id) filter.user_id = new Types.ObjectId(query.user_id);
    if (query.module) filter.module = query.module;
    if (query.action) filter.action = query.action;
    if (query.date_from || query.date_to) {
      const range: Record<string, Date> = {};
      if (query.date_from) range.$gte = new Date(query.date_from);
      if (query.date_to) {
        const to = new Date(query.date_to);
        if (query.date_to.length <= 10) to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      filter.created_at = range;
    }
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = [
        { user_name: rx },
        { user_email: rx },
        { entity_label: rx },
        { module: rx },
        { path: rx },
      ];
    }

    const [docs, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ created_at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);

    const data: AuditRow[] = docs.map((d: Record<string, any>) => ({
      id: String(d._id),
      created_at: d.created_at ? new Date(d.created_at).toISOString() : null,
      user_name: d.user_name ?? '',
      user_email: d.user_email ?? '',
      module: d.module ?? '',
      action: d.action ?? '',
      entity_label: d.entity_label ?? '',
      entity_id: d.entity_id ?? '',
      method: d.method ?? '',
      path: d.path ?? '',
      status_code: d.status_code ?? 0,
      ip: d.ip ?? '',
    }));

    return { data, total, page, limit };
  }

  private toObjectIdOrNull(id?: string | null): Types.ObjectId | null {
    return id && isValidObjectId(id) ? new Types.ObjectId(id) : null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
