import { describe, expect, it } from 'vitest';
import { CaseStore, type CaseInput } from '../lib/cases';

const input = (over: Partial<CaseInput> = {}): CaseInput => ({
  transactionId: 'txn-1',
  userId: 'u-001',
  score: 90,
  band: 'high',
  reasons: ['amount 12.0x user average'],
  amount: 900,
  currency: 'USD',
  merchant: 'LuxeGoods Intl',
  country: 'RO',
  ...over,
});

describe('CaseStore state machine', () => {
  it('opens a case for a flagged transaction (idempotent)', () => {
    const store = new CaseStore();
    const a = store.ensureOpen(input(), 1000);
    const b = store.ensureOpen(input(), 2000);
    expect(a.state).toBe('open');
    expect(b).toBe(a); // same instance, not re-created
    expect(store.list()).toHaveLength(1);
  });

  it('moves open → analyst_review → confirmed_fraud with an audit trail', () => {
    const store = new CaseStore();
    store.ensureOpen(input(), 1000);
    store.beginReview('txn-1', 'analyst', 2000);
    const decided = store.decide('txn-1', 'confirm', 'analyst', 3000);

    expect(decided.state).toBe('confirmed_fraud');
    expect(decided.decidedBy).toBe('analyst');
    expect(decided.decidedAt).toBe(3000);

    const actions = store.auditLog().map((e) => e.action);
    expect(actions).toContain('open');
    expect(actions).toContain('begin_review');
    expect(actions).toContain('confirm_fraud');
  });

  it('supports dismiss as the benign terminal state', () => {
    const store = new CaseStore();
    store.ensureOpen(input(), 1000);
    const dismissed = store.decide('txn-1', 'dismiss', 'analyst', 2000);
    expect(dismissed.state).toBe('dismissed');
  });

  it('refuses to re-decide a closed case', () => {
    const store = new CaseStore();
    store.ensureOpen(input(), 1000);
    store.decide('txn-1', 'confirm', 'analyst', 2000);
    expect(() => store.decide('txn-1', 'dismiss', 'analyst', 3000)).toThrow(/already/);
  });

  it('throws when acting on an unknown case', () => {
    const store = new CaseStore();
    expect(() => store.decide('missing', 'confirm')).toThrow(/no case/);
  });

  it('records agent proposals without changing decision state or executing', () => {
    const store = new CaseStore();
    store.ensureOpen(input(), 1000);
    const withProposal = store.recordProposal(input(), 'block_card', 'mcp-agent', 2000);
    expect(withProposal.proposedAction).toBe('block_card');
    expect(withProposal.state).toBe('open'); // proposal does NOT decide the case
    const audit = store.auditLog();
    expect(audit.some((e) => e.action === 'propose:block_card')).toBe(true);
  });

  it('emits confirmed/dismissed labels for the calibration loop', () => {
    const store = new CaseStore();
    store.ensureOpen(input({ transactionId: 'txn-1' }), 1000);
    store.ensureOpen(input({ transactionId: 'txn-2' }), 1000);
    store.ensureOpen(input({ transactionId: 'txn-3' }), 1000);
    store.decide('txn-1', 'confirm', 'analyst', 2000);
    store.decide('txn-2', 'dismiss', 'analyst', 2000);
    // txn-3 left open → not a label yet.

    const labels = store.labels();
    expect(labels).toHaveLength(2);
    expect(labels.find((l) => l.transactionId === 'txn-1')?.label).toBe(1);
    expect(labels.find((l) => l.transactionId === 'txn-2')?.label).toBe(0);
  });

  it('summarizes case counts by state', () => {
    const store = new CaseStore();
    store.ensureOpen(input({ transactionId: 'a' }));
    store.ensureOpen(input({ transactionId: 'b' }));
    store.decide('b', 'confirm');
    const summary = store.summary();
    expect(summary.total).toBe(2);
    expect(summary.byState.open).toBe(1);
    expect(summary.byState.confirmed_fraud).toBe(1);
  });
});
