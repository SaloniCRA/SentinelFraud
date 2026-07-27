/**
 * GET  /api/cases  — list analyst cases, the audit log, a state summary, and
 *                    the confirmed/dismissed labels (for the calibration loop).
 * POST /api/cases  — apply an analyst decision to a case:
 *                    { transactionId, action: 'review' | 'confirm' | 'dismiss' }.
 *
 * The terminal confirm/dismiss decision is the human-in-the-loop step: it only
 * happens on an explicit analyst request, never automatically.
 */

import { NextResponse } from 'next/server';
import { getCaseStore } from '../../../lib/cases';
import { caseActionSchema } from '../../../lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const store = getCaseStore();
  return NextResponse.json({
    cases: store.list(),
    audit: store.auditLog(),
    summary: store.summary(),
    labels: store.labels(),
  });
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be JSON' }, { status: 400 });
  }

  const parsed = caseActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const store = getCaseStore();
  const { transactionId, action } = parsed.data;

  try {
    const fraudCase =
      action === 'review' ? store.beginReview(transactionId) : store.decide(transactionId, action);
    return NextResponse.json({ case: fraudCase });
  } catch (err) {
    // Unknown case, or an illegal transition (e.g. re-deciding a closed case).
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'case transition failed' },
      { status: 409 },
    );
  }
}
