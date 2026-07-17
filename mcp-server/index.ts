/**
 * SentinelFraud MCP server (stdio).
 *
 * Exposes the same pure fraud engine used by the dashboard as Model
 * Context Protocol tools, so MCP clients (e.g. Claude Desktop) can score
 * transactions, list flagged activity from a deterministic seeded batch,
 * request plain-English alert explanations, and pull aggregate stats.
 *
 * Run with: npm run mcp
 *
 * IMPORTANT: stdout carries the MCP protocol — all logging goes to stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  CONFIG,
  categorizeReason,
  isFlagged,
  scoreTransaction,
  type RiskResult,
  type Transaction,
  type UserBaseline,
} from '../lib/fraud-engine';
import { createTransactionStream, DEFAULT_SEED } from '../lib/generator';
import { lookupBin, type BinInfo } from '../lib/bin-lookup';
import { explainTransaction } from '../lib/explain';
import { recentTimestampsSchema, transactionSchema } from '../lib/validation';

interface ScoredRecord {
  transaction: Transaction;
  enrichment: BinInfo;
  result: RiskResult;
}

const BATCH_SIZE = 300;

/**
 * The seeded stream (fixed seed + fixed genesis clock) makes the batch
 * deterministic, so repeated tool calls in one session are consistent.
 */
const stream = createTransactionStream({ seed: DEFAULT_SEED });
let batchPromise: Promise<ScoredRecord[]> | null = null;

function neutralBaseline(tx: Transaction): UserBaseline {
  return {
    userId: tx.userId,
    avgAmount: Math.max(tx.amount, 1),
    stdevAmount: Math.max(tx.amount * 0.5, 1),
    usualCountry: tx.country,
    activeHours: { start: 0, end: 23 },
  };
}

async function scoreWithEnrichment(
  tx: Transaction,
  recentUserTimestamps: number[],
): Promise<ScoredRecord> {
  const enrichment = await lookupBin(tx.cardBin);
  const baseline = stream.baselines.get(tx.userId) ?? neutralBaseline(tx);
  const result = scoreTransaction(tx, baseline, {
    recentUserTimestamps,
    binCountry: enrichment.country,
  });
  return { transaction: tx, enrichment, result };
}

function buildBatch(): Promise<ScoredRecord[]> {
  batchPromise ??= (async () => {
    const transactions = stream.generateBatch(BATCH_SIZE);
    const perUserTimestamps = new Map<string, number[]>();
    const records: ScoredRecord[] = [];
    for (const tx of transactions) {
      const recent = perUserTimestamps.get(tx.userId) ?? [];
      records.push(await scoreWithEnrichment(tx, recent));
      recent.push(tx.timestamp);
      perUserTimestamps.set(tx.userId, recent);
    }
    return records;
  })();
  return batchPromise;
}

const TOOLS = [
  {
    name: 'score_transaction',
    description:
      'Score a single transaction with the SentinelFraud rule engine. Returns { score: 0-100, band: low|medium|high, reasons: string[] }. ' +
      'Seeded demo users u-001 through u-008 have known baselines; other userIds are scored against a neutral baseline. ' +
      'Optionally pass recentUserTimestamps (epoch ms of the same user’s prior transactions) to exercise the velocity signal.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          description: 'The transaction to score.',
          properties: {
            id: { type: 'string', description: 'Transaction id (1-64 chars, [A-Za-z0-9_-]).' },
            userId: { type: 'string', description: 'User id, e.g. "u-001".' },
            amount: { type: 'number', description: 'Transaction amount (positive).' },
            currency: { type: 'string', description: '3-letter ISO currency code, e.g. "USD".' },
            timestamp: { type: 'number', description: 'Epoch milliseconds (UTC).' },
            merchant: { type: 'string', description: 'Merchant display name.' },
            category: { type: 'string', description: 'Merchant category, e.g. "retail".' },
            country: { type: 'string', description: '2-letter ISO country of the transaction.' },
            cardBin: { type: 'string', description: 'First 6 digits of the card number.' },
          },
          required: [
            'id',
            'userId',
            'amount',
            'currency',
            'timestamp',
            'merchant',
            'category',
            'country',
            'cardBin',
          ],
        },
        recentUserTimestamps: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Optional epoch-ms timestamps of this user’s recent prior transactions (velocity signal).',
        },
      },
      required: ['transaction'],
    },
  },
  {
    name: 'list_flagged_transactions',
    description:
      'List flagged (risky) transactions from the deterministic seeded demo batch. ' +
      `Returns transactions with score >= minScore (default ${CONFIG.bands.medium}, the medium-band threshold).`,
    inputSchema: {
      type: 'object',
      properties: {
        minScore: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: `Minimum risk score to include (default ${CONFIG.bands.medium}).`,
        },
      },
    },
  },
  {
    name: 'explain_alert',
    description:
      'Return a 2-3 sentence plain-English analyst explanation for a flagged transaction from the demo batch, by transaction id. ' +
      'Uses Gemini when GEMINI_API_KEY is set, otherwise a deterministic rule-based template.',
    inputSchema: {
      type: 'object',
      properties: {
        transactionId: {
          type: 'string',
          description: 'Transaction id from list_flagged_transactions, e.g. "txn-00042".',
        },
      },
      required: ['transactionId'],
    },
  },
  {
    name: 'get_fraud_stats',
    description:
      'Aggregate fraud statistics over the deterministic seeded demo batch: totals, flagged count and rate, average score, band distribution, and top risk signals.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function jsonResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'score_transaction': {
      const parsedTx = transactionSchema.safeParse(args.transaction);
      if (!parsedTx.success) {
        return errorResult(`Invalid transaction: ${parsedTx.error.message}`);
      }
      const parsedRecent = recentTimestampsSchema.safeParse(args.recentUserTimestamps ?? []);
      if (!parsedRecent.success) {
        return errorResult('Invalid recentUserTimestamps: must be an array of epoch-ms numbers.');
      }
      const record = await scoreWithEnrichment(parsedTx.data, parsedRecent.data);
      return jsonResult(record);
    }

    case 'list_flagged_transactions': {
      const minScore =
        typeof args.minScore === 'number' && Number.isFinite(args.minScore)
          ? Math.min(100, Math.max(0, args.minScore))
          : CONFIG.bands.medium;
      const batch = await buildBatch();
      const flagged = batch.filter((r) => r.result.score >= minScore);
      return jsonResult({
        minScore,
        count: flagged.length,
        batchSize: batch.length,
        transactions: flagged,
      });
    }

    case 'explain_alert': {
      if (typeof args.transactionId !== 'string') {
        return errorResult('transactionId (string) is required.');
      }
      const batch = await buildBatch();
      const record = batch.find((r) => r.transaction.id === args.transactionId);
      if (!record) {
        return errorResult(
          `Transaction ${args.transactionId} not found in the demo batch. Use list_flagged_transactions to get valid ids.`,
        );
      }
      const { explanation, source } = await explainTransaction(
        record.transaction,
        record.result,
        record.enrichment,
      );
      return jsonResult({
        transactionId: record.transaction.id,
        explanation,
        source,
        score: record.result.score,
        band: record.result.band,
        reasons: record.result.reasons,
      });
    }

    case 'get_fraud_stats': {
      const batch = await buildBatch();
      const flagged = batch.filter((r) => isFlagged(r.result));
      const bands = { low: 0, medium: 0, high: 0 };
      const signals = new Map<string, number>();
      let scoreSum = 0;
      for (const record of batch) {
        bands[record.result.band] += 1;
        scoreSum += record.result.score;
        for (const reason of record.result.reasons) {
          const key = categorizeReason(reason);
          signals.set(key, (signals.get(key) ?? 0) + 1);
        }
      }
      return jsonResult({
        total: batch.length,
        flagged: flagged.length,
        flaggedRate: Number((flagged.length / batch.length).toFixed(4)),
        averageScore: Number((scoreSum / batch.length).toFixed(2)),
        bands,
        topSignals: [...signals.entries()]
          .map(([signal, count]) => ({ signal, count }))
          .sort((a, b) => b.count - a.count),
      });
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

async function main() {
  const server = new Server(
    { name: 'sentinelfraud', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await handleToolCall(name, args ?? {});
    } catch (err) {
      if (err instanceof McpError) throw err;
      return errorResult(
        `Tool ${name} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  server.onclose = () => process.exit(0);
  console.error('SentinelFraud MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error starting SentinelFraud MCP server:', err);
  process.exit(1);
});
