import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, map, merge, interval } from 'rxjs';

/** What a screen is told happened, so it can refresh itself. */
export interface RealtimeEvent {
  /** e.g. 'stock-request.created' */
  type: string;
  /** small payload: ids and a label, never a whole document */
  payload: Record<string, unknown>;
  at: string;
}

interface Addressed {
  officeId: string;
  event: RealtimeEvent;
}

/** The shape Nest's @Sse() serialises. */
export interface SseMessage {
  data: string;
  type?: string;
}

/**
 * A branch-addressed event bus for the browser.
 *
 * One process, one in-memory subject: this is not a message broker and it does
 * not try to be. If the API is ever run as more than one process, this needs a
 * shared transport (Redis pub/sub) behind the same interface — until then an
 * event is simply handed to whoever is listening on this box.
 *
 * Clients never act on the payload itself; they take it as a nudge to re-read
 * from the API, so a missed event costs a stale list until the next one, not a
 * wrong figure.
 */
@Injectable()
export class RealtimeService {
  private readonly events$ = new Subject<Addressed>();

  /** Tell every screen in these offices that something happened. */
  publish(officeIds: (string | null | undefined)[], event: Omit<RealtimeEvent, 'at'>) {
    const at = new Date().toISOString();
    const seen = new Set<string>();
    for (const id of officeIds) {
      const officeId = id ? String(id) : '';
      if (!officeId || seen.has(officeId)) continue;
      seen.add(officeId);
      this.events$.next({ officeId, event: { ...event, at } });
    }
  }

  /**
   * The stream one office listens to. The heartbeat is not decoration: idle
   * connections get closed by proxies and some browsers, and a comment every
   * 25s keeps the line open without waking the UI.
   */
  streamFor(officeId: string): Observable<SseMessage> {
    const events = this.events$.pipe(
      filter((e) => e.officeId === officeId),
      map((e) => ({ type: 'message', data: JSON.stringify(e.event) })),
    );
    const heartbeat = interval(25_000).pipe(
      map(() => ({
        type: 'ping',
        data: JSON.stringify({ type: 'ping', at: new Date().toISOString() }),
      })),
    );
    return merge(events, heartbeat);
  }
}
