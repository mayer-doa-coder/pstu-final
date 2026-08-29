/** What kind of resource an activity row points at. */
export type ActivityType = 'TRANSFER' | 'MONEY_REQUEST';

/**
 * `OUT` / `IN` for money the caller sent / received; `REQUEST` for a money
 * request the caller is party to (as requester or as payer).
 */
export type ActivityDirection = 'IN' | 'OUT' | 'REQUEST';

export interface ActivityCounterparty {
  userId: string;
  displayName: string;
}

/**
 * One normalized entry in the caller's activity feed — a transfer or a money
 * request they participate in, flattened to a single shape
 * (IMPLEMENTATION_GUIDE.md §3.8).
 */
export interface ActivityItemDto {
  /** `transfer:<uuid>` or `request:<uuid>` — stable, resource-qualified. */
  activityId: string;
  referenceId: string;
  type: ActivityType;
  direction: ActivityDirection;
  amountMinor: number;
  currency: string;
  status: string;
  counterparty: ActivityCounterparty | null;
  createdAt: string;
  /** The money request a transfer settled, if any. */
  relatedRequestId: string | null;
  /** The transfer that settled a request, once it has been accepted. */
  relatedTransferId: string | null;
}
