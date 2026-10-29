import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { RealtimeService } from '../../common/realtime/realtime.service';
import { QueryNotificationDto } from './dto/notification.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

/** One line on the bell, as a screen reads it. */
export interface NotificationRow {
  id: string;
  type: string;
  title_key: string;
  params: Record<string, string>;
  link: string;
  link_params: Record<string, string>;
  ref_id: string | null;
  read: boolean;
  created_at: Date;
}

/** What a caller hands over to raise one. */
export interface PushNotification {
  /** the branches to tell; duplicates and blanks are ignored */
  officeIds: (string | Types.ObjectId | null | undefined)[];
  type: string;
  title_key: string;
  params?: Record<string, string>;
  link?: string;
  link_params?: Record<string, string>;
  refId?: string | Types.ObjectId | null;
  userId?: string | null;
}

/**
 * The bell.
 *
 * Two things have to happen when a branch should be told something: it has to
 * be *kept*, so the bell still shows it tomorrow morning, and it has to be
 * *announced*, so a screen that is open right now lights up without a refresh.
 * Callers say what happened once and this does both.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly model: Model<NotificationDocument>,
    private readonly realtime: RealtimeService,
  ) {}

  /** Write one notification per branch, then nudge their open screens. */
  async push(input: PushNotification): Promise<void> {
    const seen = new Set<string>();
    for (const raw of input.officeIds) {
      const officeId = raw ? String(raw) : '';
      if (!officeId || seen.has(officeId)) continue;
      seen.add(officeId);

      await this.model.create({
        office_id: new Types.ObjectId(officeId),
        type: input.type,
        title_key: input.title_key,
        params: input.params ?? {},
        link: input.link ?? '',
        link_params: input.link_params ?? {},
        ref_id: input.refId ? new Types.ObjectId(String(input.refId)) : null,
        created_by: input.userId ? new Types.ObjectId(input.userId) : null,
      });
    }

    // the bell's own event: screens re-read the count rather than trust this
    this.realtime.publish([...seen], {
      type: 'notification.created',
      payload: { kind: input.type },
    });
  }

  /** The newest first, for one branch. */
  async findAll(query: QueryNotificationDto): Promise<{
    data: NotificationRow[];
    unread: number;
  }> {
    const filter: Record<string, any> = {};
    if (query.office_id) filter.office_id = new Types.ObjectId(query.office_id);
    if (query.unread_only) filter.read_at = null;

    const [docs, unread] = await Promise.all([
      this.model
        .find(filter)
        .sort({ created_at: -1 })
        .limit(query.limit ?? 20)
        .lean()
        .exec(),
      this.unreadCount(query.office_id),
    ]);

    return { data: docs.map((doc) => this.toRow(doc)), unread };
  }

  /** What the badge shows. */
  async unreadCount(officeId?: string): Promise<number> {
    const filter: Record<string, any> = { read_at: null };
    if (officeId) filter.office_id = new Types.ObjectId(officeId);
    return this.model.countDocuments(filter).exec();
  }

  /** One line, read. Scoped to the branch so a stray id cannot clear it. */
  async markRead(id: string, officeId?: string): Promise<{ unread: number }> {
    const filter: Record<string, any> = { _id: new Types.ObjectId(id), read_at: null };
    if (officeId) filter.office_id = new Types.ObjectId(officeId);
    await this.model.updateOne(filter, { $set: { read_at: new Date() } }).exec();
    return { unread: await this.unreadCount(officeId) };
  }

  /** The whole bell, read. */
  async markAllRead(officeId?: string): Promise<{ unread: number }> {
    const filter: Record<string, any> = { read_at: null };
    if (officeId) filter.office_id = new Types.ObjectId(officeId);
    await this.model.updateMany(filter, { $set: { read_at: new Date() } }).exec();
    return { unread: 0 };
  }

  private toRow(doc: Record<string, any>): NotificationRow {
    return {
      id: String(doc._id),
      type: doc.type,
      title_key: doc.title_key,
      params: doc.params ?? {},
      link: doc.link ?? '',
      link_params: doc.link_params ?? {},
      ref_id: doc.ref_id ? String(doc.ref_id) : null,
      read: !!doc.read_at,
      created_at: doc.created_at,
    };
  }
}
