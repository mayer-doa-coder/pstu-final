import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the current request's correlation ID across async boundaries so
 * any log line emitted while handling a request — regardless of how deep in
 * the call stack — can be tagged with it, without threading it through every
 * function signature.
 */
export const requestContext = new AsyncLocalStorage<string>();
