import type { z } from 'zod';

/** One invoke channel: the zod schema of its request and of the data in its ok Result. */
export interface InvokeContract {
  request: z.ZodType;
  response: z.ZodType;
}
