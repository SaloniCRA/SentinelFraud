/**
 * POST /api/explain
 *
 * Takes `{ transactionId }` (preferred) or `{ transaction }` and returns a
 * 2-3 sentence plain-English explanation of the alert.
 *
 * Security notes:
 *  - Client-supplied `reasons` are never accepted: the record is looked up
 *    server-side, or the supplied transaction is re-scored server-side, so
 *    only engine-derived signals ever reach the prompt.
 *  - Only structured, validated fields are passed to Gemini (see
 *    lib/explain.ts). With no GEMINI_API_KEY, or on any failure, a
 *    deterministic template is returned so the UI always works.
 */

import { NextResponse } from 'next/server';
import { getStore } from '../../../lib/store';
import { explainRequestSchema } from '../../../lib/validation';
import { explainTransaction } from '../../../lib/explain';
import type { ScoredRecord } from '../../../lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const parsed = explainRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getStore();
  let record: ScoredRecord | undefined;

  if (parsed.data.transactionId) {
    record = store.getRecord(parsed.data.transactionId);
  }
  if (!record && parsed.data.transaction) {
    // Unknown id but a validated transaction was supplied: re-score it
    // server-side so the reasons fed to the prompt are engine-derived.
    record = await store.scoreExternal(parsed.data.transaction);
  }
  if (!record) {
    return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
  }

  const { explanation, source } = await explainTransaction(
    record.transaction,
    record.result,
    record.enrichment.bin,
  );

  return NextResponse.json({
    transactionId: record.transaction.id,
    explanation,
    source,
    score: record.result.score,
    band: record.result.band,
    reasons: record.result.reasons,
  });
}
