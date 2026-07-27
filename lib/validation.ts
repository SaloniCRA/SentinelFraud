/**
 * SentinelFraud — request validation schemas.
 *
 * Every externally supplied payload (API routes, MCP tool arguments) is
 * validated against these strict schemas before it touches the engine or
 * any prompt. Unknown keys are rejected.
 */

import { z } from 'zod';

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

export const transactionSchema = z
  .object({
    id: z.string().regex(idPattern, 'id must be 1-64 chars of [A-Za-z0-9_-]'),
    userId: z.string().regex(idPattern, 'userId must be 1-64 chars of [A-Za-z0-9_-]'),
    amount: z.number().finite().positive().max(10_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code'),
    timestamp: z.number().int().positive(),
    merchant: z.string().min(1).max(64),
    category: z.string().min(1).max(32),
    country: z.string().regex(/^[A-Z]{2}$/, 'country must be a 2-letter ISO code'),
    cardBin: z.string().regex(/^\d{6,8}$/, 'cardBin must be 6-8 digits'),
    ip: z
      .string()
      .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'ip must be a dotted-quad IPv4 address')
      .optional(),
    email: z.string().max(254).email('email must be a valid address').optional(),
  })
  .strict();

export type ValidatedTransaction = z.infer<typeof transactionSchema>;

export const explainRequestSchema = z
  .object({
    transactionId: z.string().regex(idPattern).optional(),
    transaction: transactionSchema.optional(),
  })
  .strict()
  .refine((v) => v.transactionId !== undefined || v.transaction !== undefined, {
    message: 'transactionId or transaction is required',
  });

export const recentTimestampsSchema = z.array(z.number().int().positive()).max(500);

export const caseActionSchema = z
  .object({
    transactionId: z.string().regex(idPattern),
    action: z.enum(['review', 'confirm', 'dismiss']),
  })
  .strict();
