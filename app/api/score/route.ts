/**
 * POST /api/score
 *
 * With an empty body (or `{}`): generates the next transaction from the
 * seeded stream, enriches it via BIN lookup, scores it, and returns the
 * full record. This is what the dashboard polls.
 *
 * With `{ transaction: {...} }`: validates the supplied transaction
 * strictly, then enriches and scores it the same way.
 */

import { NextResponse } from 'next/server';
import { getStore } from '../../../lib/store';
import { transactionSchema } from '../../../lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Empty or non-JSON body → generate the next stream transaction.
  }

  const store = getStore();

  if (body !== null && typeof body === 'object' && 'transaction' in body) {
    const parsed = transactionSchema.safeParse((body as { transaction: unknown }).transaction);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'invalid transaction', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const record = await store.scoreExternal(parsed.data);
    return NextResponse.json(record);
  }

  const record = await store.ingestNext();
  return NextResponse.json(record);
}
