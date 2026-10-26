import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * Leaves a route's return value alone instead of wrapping it in the
 * `{ success, message, data }` envelope. Server-sent events are a stream of
 * their own shape, and an envelope around every tick would break the client's
 * parser.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
