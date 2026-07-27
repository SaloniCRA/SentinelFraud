/**
 * SentinelFraud — analyst case store (human-in-the-loop).
 *
 * Flagged transactions become CASES that move through an explicit state
 * machine: open → analyst_review → {confirmed_fraud | dismissed}. Every
 * transition is recorded in an append-only audit log with actor + timestamp.
 *
 * This is the mechanism behind the governance claim that "a person confirms
 * any account action": the engine and agents can only OPEN and PROPOSE; the
 * terminal confirm/dismiss decision is always an explicit analyst action.
 * Confirmed/dismissed outcomes become labels for the Phase 4 calibration loop.
 *
 * In-memory per process (demo); swap for a durable store in production.
 */

import type { RiskBand } from './fraud-engine';

export type CaseState = 'open' | 'analyst_review' | 'confirmed_fraud' | 'dismissed';

export const TERMINAL_STATES: readonly CaseState[] = ['confirmed_fraud', 'dismissed'];

/** Actions an agent may PROPOSE (never execute) for human confirmation. */
export const PROPOSABLE_ACTIONS = [
  'hold_transaction',
  'block_card',
  'contact_cardholder',
  'escalate',
  'dismiss',
] as const;
export type ProposableAction = (typeof PROPOSABLE_ACTIONS)[number];

export interface FraudCase {
  transactionId: string;
  userId: string;
  score: number;
  band: RiskBand;
  reasons: string[];
  amount: number;
  currency: string;
  merchant: string;
  country: string;
  state: CaseState;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  /** Last agent-proposed action awaiting human confirmation, if any. */
  proposedAction: ProposableAction | null;
}

export interface AuditEntry {
  at: number;
  transactionId: string;
  actor: string;
  action: string;
  fromState: CaseState | null;
  toState: CaseState | null;
  note?: string;
}

export interface CaseInput {
  transactionId: string;
  userId: string;
  score: number;
  band: RiskBand;
  reasons: string[];
  amount: number;
  currency: string;
  merchant: string;
  country: string;
}

/** Label for the calibration loop: 1 = confirmed fraud, 0 = dismissed. */
export interface CaseLabel {
  transactionId: string;
  label: 0 | 1;
  decidedAt: number;
}

const MAX_AUDIT = 1_000;

export class CaseStore {
  private cases = new Map<string, FraudCase>();
  private audit: AuditEntry[] = [];

  private log(entry: AuditEntry): void {
    this.audit.push(entry);
    if (this.audit.length > MAX_AUDIT) this.audit.splice(0, this.audit.length - MAX_AUDIT);
  }

  /** Create an `open` case for a flagged transaction (idempotent). */
  ensureOpen(input: CaseInput, now: number = Date.now()): FraudCase {
    const existing = this.cases.get(input.transactionId);
    if (existing) return existing;
    const fraudCase: FraudCase = {
      ...input,
      state: 'open',
      createdAt: now,
      updatedAt: now,
      decidedAt: null,
      decidedBy: null,
      proposedAction: null,
    };
    this.cases.set(input.transactionId, fraudCase);
    this.log({
      at: now,
      transactionId: input.transactionId,
      actor: 'system',
      action: 'open',
      fromState: null,
      toState: 'open',
    });
    return fraudCase;
  }

  /** Move an open case into analyst_review (idempotent, no-op if terminal). */
  beginReview(transactionId: string, actor = 'analyst', now: number = Date.now()): FraudCase {
    const fraudCase = this.require(transactionId);
    if (fraudCase.state === 'open') {
      const from = fraudCase.state;
      fraudCase.state = 'analyst_review';
      fraudCase.updatedAt = now;
      this.log({
        at: now,
        transactionId,
        actor,
        action: 'begin_review',
        fromState: from,
        toState: 'analyst_review',
      });
    }
    return fraudCase;
  }

  /**
   * Terminal analyst decision. `decision` maps to confirmed_fraud/dismissed.
   * Throws if the case is already decided (terminal states are immutable).
   */
  decide(
    transactionId: string,
    decision: 'confirm' | 'dismiss',
    actor = 'analyst',
    now: number = Date.now(),
  ): FraudCase {
    const fraudCase = this.require(transactionId);
    if (TERMINAL_STATES.includes(fraudCase.state)) {
      throw new Error(`case ${transactionId} is already ${fraudCase.state}`);
    }
    const from = fraudCase.state;
    const toState: CaseState = decision === 'confirm' ? 'confirmed_fraud' : 'dismissed';
    fraudCase.state = toState;
    fraudCase.updatedAt = now;
    fraudCase.decidedAt = now;
    fraudCase.decidedBy = actor;
    this.log({
      at: now,
      transactionId,
      actor,
      action: decision === 'confirm' ? 'confirm_fraud' : 'dismiss',
      fromState: from,
      toState,
    });
    return fraudCase;
  }

  /**
   * Record an agent-PROPOSED action. This never changes the case's decision
   * state and never executes anything — it only annotates the case and logs
   * the proposal for a human to confirm.
   */
  recordProposal(
    input: CaseInput,
    action: ProposableAction,
    actor = 'agent',
    now: number = Date.now(),
  ): FraudCase {
    const fraudCase = this.ensureOpen(input, now);
    fraudCase.proposedAction = action;
    fraudCase.updatedAt = now;
    this.log({
      at: now,
      transactionId: input.transactionId,
      actor,
      action: `propose:${action}`,
      fromState: fraudCase.state,
      toState: fraudCase.state,
      note: 'proposal only — awaiting human confirmation',
    });
    return fraudCase;
  }

  get(transactionId: string): FraudCase | undefined {
    return this.cases.get(transactionId);
  }

  private require(transactionId: string): FraudCase {
    const fraudCase = this.cases.get(transactionId);
    if (!fraudCase) throw new Error(`no case for transaction ${transactionId}`);
    return fraudCase;
  }

  list(): FraudCase[] {
    return [...this.cases.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  auditLog(limit = 100): AuditEntry[] {
    return this.audit.slice(-limit).reverse();
  }

  /** Confirmed/dismissed cases as labels for the calibration loop. */
  labels(): CaseLabel[] {
    return this.list()
      .filter((c) => TERMINAL_STATES.includes(c.state) && c.decidedAt != null)
      .map((c) => ({
        transactionId: c.transactionId,
        label: c.state === 'confirmed_fraud' ? 1 : 0,
        decidedAt: c.decidedAt as number,
      }));
  }

  summary(): { total: number; byState: Record<CaseState, number> } {
    const byState: Record<CaseState, number> = {
      open: 0,
      analyst_review: 0,
      confirmed_fraud: 0,
      dismissed: 0,
    };
    for (const c of this.cases.values()) byState[c.state] += 1;
    return { total: this.cases.size, byState };
  }
}

/** Singleton accessor, resilient to Next.js dev hot reloads. */
export function getCaseStore(): CaseStore {
  const g = globalThis as typeof globalThis & { __sentinelCaseStore?: CaseStore };
  g.__sentinelCaseStore ??= new CaseStore();
  return g.__sentinelCaseStore;
}
