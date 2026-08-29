/**
 * A user-facing notification. Deliberately carries no financial amounts or
 * counterparty internals beyond what the title/body already say — the client
 * follows `resourceType` + `resourceId` to the authorized detail endpoint for
 * anything more.
 */
export interface NotificationDto {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}
