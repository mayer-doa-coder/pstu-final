import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatMinorUnits } from '../common/money/format-minor.util';
import type { ClaimedOutboxEvent } from '../outbox/outbox.repository';
import { NotificationsRepository } from './notifications.repository';

/** One notification this consumer decided to produce from an event. */
interface PlannedNotification {
  userId: string;
  type: string;
  title: string;
  body: string;
  resourceType: 'transfer' | 'money_request';
  resourceId: string;
}

/**
 * Turns domain events drained from the outbox into in-app notifications.
 *
 * Idempotency: delivery is at-least-once, so the same event may arrive twice
 * (a worker crash between the consumer's commit and the processed flag, say).
 * Every insert goes through `insertIfAbsent`, which relies on the UNIQUE
 * `(source_event_id, user_id)` index — so a replay writes nothing rather than
 * duplicating a notification.
 *
 * This consumer runs in the worker process only. Nothing here can affect a
 * financial transaction: by the time an event is visible to the worker, the
 * money has already committed.
 */
@Injectable()
export class NotificationConsumer {
  constructor(private readonly notifications: NotificationsRepository) {}

  async handle(tx: Prisma.TransactionClient, event: ClaimedOutboxEvent): Promise<void> {
    for (const planned of this.plan(event)) {
      await this.notifications.insertIfAbsent(tx, {
        userId: planned.userId,
        type: planned.type,
        title: planned.title,
        body: planned.body,
        resourceType: planned.resourceType,
        resourceId: planned.resourceId,
        sourceEventId: event.id,
      });
    }
  }

  /**
   * An unrecognized event type yields no notifications — the worker still
   * marks it processed rather than retrying it forever, since a consumer that
   * has nothing to say about an event has succeeded, not failed.
   */
  private plan(event: ClaimedOutboxEvent): PlannedNotification[] {
    switch (event.eventType) {
      case 'transfer.succeeded':
        return this.onTransferSucceeded(event);
      case 'money_request.created':
        return this.onRequestCreated(event);
      case 'money_request.accepted':
        return this.onRequestAccepted(event);
      case 'money_request.declined':
        return this.onRequestResolvedByPayer(event, 'declined');
      case 'money_request.cancelled':
        return this.onRequestCancelled(event);
      default:
        return [];
    }
  }

  private onTransferSucceeded(event: ClaimedOutboxEvent): PlannedNotification[] {
    const p = event.payload;
    // A request-sourced transfer already notifies the requester via
    // `money_request.accepted`; notifying again here would double-report the
    // same money arriving.
    if (p.sourceRequestId) {
      return [];
    }

    return [
      {
        userId: String(p.receiverUserId),
        type: 'money_received',
        title: 'Money received',
        body: `You received ${this.amount(p)}.`,
        resourceType: 'transfer',
        resourceId: String(p.transferId),
      },
    ];
  }

  private onRequestCreated(event: ClaimedOutboxEvent): PlannedNotification[] {
    const p = event.payload;
    return [
      {
        userId: String(p.payerUserId),
        type: 'money_request_received',
        title: 'Money requested',
        body: `Someone requested ${this.amount(p)} from you.`,
        resourceType: 'money_request',
        resourceId: String(p.requestId),
      },
    ];
  }

  private onRequestAccepted(event: ClaimedOutboxEvent): PlannedNotification[] {
    const p = event.payload;
    return [
      {
        userId: String(p.requesterUserId),
        type: 'money_request_accepted',
        title: 'Request accepted',
        body: `Your request for ${this.amount(p)} was accepted and paid.`,
        resourceType: 'money_request',
        resourceId: String(p.requestId),
      },
    ];
  }

  private onRequestResolvedByPayer(
    event: ClaimedOutboxEvent,
    outcome: 'declined',
  ): PlannedNotification[] {
    const p = event.payload;
    return [
      {
        userId: String(p.requesterUserId),
        type: `money_request_${outcome}`,
        title: 'Request declined',
        body: `Your request for ${this.amount(p)} was declined.`,
        resourceType: 'money_request',
        resourceId: String(p.requestId),
      },
    ];
  }

  private onRequestCancelled(event: ClaimedOutboxEvent): PlannedNotification[] {
    const p = event.payload;
    // The payer is the one who no longer owes anything, so they are the one
    // who needs to hear about a cancellation.
    return [
      {
        userId: String(p.payerUserId),
        type: 'money_request_cancelled',
        title: 'Request cancelled',
        body: `A request for ${this.amount(p)} was cancelled.`,
        resourceType: 'money_request',
        resourceId: String(p.requestId),
      },
    ];
  }

  /** Payload amounts travel as strings so JSONB round-trips them exactly. */
  private amount(payload: Record<string, unknown>): string {
    return formatMinorUnits(BigInt(String(payload.amountMinor)), String(payload.currency ?? 'BDT'));
  }
}
