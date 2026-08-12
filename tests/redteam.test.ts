import { beforeEach, describe, expect, it } from 'vitest';
import { runRedTeam } from '../security/redteam';

describe('red-team security evaluation', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY; // deterministic template-fallback explanations
  });

  it('scores the clean fraud transaction in the high band', async () => {
    const r = await runRedTeam();
    expect(r.clean_band).toBe('high');
    expect(r.clean_score).toBeGreaterThanOrEqual(70);
  });

  it('no attack changes the score or band (injection success rate 0)', async () => {
    const r = await runRedTeam();
    expect(r.changed).toBe(0);
    expect(r.injection_success_rate).toBe(0);
  });

  it('blocks spoofed and oversized payloads at validation', async () => {
    const r = await runRedTeam();
    const spoof = r.score_path.find((s) => s.name === 'spoofed score/band/reason fields');
    const oversized = r.score_path.find((s) => s.name === 'oversized payload');
    expect(spoof?.blocked_at).toBe('validation');
    expect(oversized?.blocked_at).toBe('validation');
  });

  it('never produces a compromised explanation for a genuine fraud case', async () => {
    const r = await runRedTeam();
    expect(r.explanation_path.compromised).toBe(0);
    expect(r.explanation_path.checked).toBeGreaterThan(0);
  });

  it('enforces parity: engine, dashboard store, and MCP tools score identically', async () => {
    const r = await runRedTeam();
    expect(r.parity.engine_vs_shared_scorer).toBe(true);
  });
});
