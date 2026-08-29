import type { AuthenticatedUser } from './authenticated-user';

// Augments Express's Request type with the correlation ID that
// RequestIdMiddleware attaches to every inbound request, and the identity
// JwtAuthGuard attaches once an access token verifies.
//
// This file has an `import`, which makes it a module — so the augmentation
// must be wrapped in `declare global` to still reach the *global* Express
// namespace; without it, TS would scope `Express` to this file only and the
// augmentation would silently have no effect anywhere else.
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthenticatedUser;
    }
  }
}
