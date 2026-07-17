/**
 * SentinelFraud — synthetic transaction stream.
 *
 * Seeds 8 users with realistic baselines and emits a rolling stream of
 * transactions, ~10% of which are fraudulent (large amounts, foreign
 * countries, rapid bursts, middle-of-the-night timestamps).
 *
 * Uses a seedable PRNG (mulberry32) so runs are fully reproducible:
 * two streams created with the same seed and startTime produce identical
 * batches, which the unit tests rely on.
 */

import type { Transaction, UserBaseline } from './fraud-engine';

export const DEFAULT_SEED = 20260717;

/** Fixed genesis clock so seeded runs are reproducible in tests and the MCP server. */
export const GENESIS_TIME = Date.UTC(2026, 6, 17, 12, 0, 0);

/** Deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface UserProfile {
  baseline: UserBaseline;
  currency: string;
  cardBin: string;
  merchants: string[];
  categories: string[];
}

const profile = (
  userId: string,
  usualCountry: string,
  currency: string,
  avgAmount: number,
  stdevAmount: number,
  activeStart: number,
  activeEnd: number,
  cardBin: string,
  merchants: string[],
  categories: string[],
): UserProfile => ({
  baseline: {
    userId,
    avgAmount,
    stdevAmount,
    usualCountry,
    activeHours: { start: activeStart, end: activeEnd },
  },
  currency,
  cardBin,
  merchants,
  categories,
});

/** Eight seeded demo users. u-008 has a midnight-wrapping active window. */
export const USERS: UserProfile[] = [
  profile(
    'u-001',
    'US',
    'USD',
    62,
    21,
    8,
    22,
    '411111',
    ['Blue Bottle Coffee', 'Whole Foods Market', 'Amazon.com', 'Shell Gas'],
    ['dining', 'groceries', 'retail', 'fuel'],
  ),
  profile(
    'u-002',
    'US',
    'USD',
    145,
    60,
    7,
    21,
    '424242',
    ['Best Buy', 'Home Depot', 'Costco', 'Uber'],
    ['electronics', 'home', 'wholesale', 'transport'],
  ),
  profile(
    'u-003',
    'GB',
    'GBP',
    48,
    18,
    6,
    20,
    '465942',
    ['Tesco', 'Pret A Manger', 'TfL Travel', 'Boots'],
    ['groceries', 'dining', 'transport', 'pharmacy'],
  ),
  profile(
    'u-004',
    'DE',
    'EUR',
    88,
    35,
    7,
    21,
    '530127',
    ['REWE', 'Zalando', 'Deutsche Bahn', 'MediaMarkt'],
    ['groceries', 'retail', 'transport', 'electronics'],
  ),
  profile(
    'u-005',
    'US',
    'USD',
    230,
    95,
    9,
    23,
    '374245',
    ['Delta Air Lines', 'Marriott Hotels', "Ruth's Chris", 'Apple Store'],
    ['travel', 'lodging', 'dining', 'electronics'],
  ),
  profile(
    'u-006',
    'IN',
    'INR',
    1400,
    600,
    5,
    19,
    '608001',
    ['Flipkart', 'Swiggy', 'BigBasket', 'IRCTC'],
    ['retail', 'dining', 'groceries', 'transport'],
  ),
  profile(
    'u-007',
    'CA',
    'CAD',
    75,
    28,
    8,
    22,
    '450140',
    ['Tim Hortons', 'Loblaws', 'Canadian Tire', 'Petro-Canada'],
    ['dining', 'groceries', 'home', 'fuel'],
  ),
  profile(
    'u-008',
    'AU',
    'AUD',
    110,
    44,
    21,
    11,
    '516320',
    ['Woolworths', 'Bunnings', 'Opal Transport', 'JB Hi-Fi'],
    ['groceries', 'home', 'transport', 'electronics'],
  ),
];

/** Countries/merchants/BINs used only by the fraudulent patterns. */
const FRAUD_COUNTRIES = ['RO', 'NG', 'VN', 'BR', 'UA', 'PH'];
const FRAUD_BINS = ['531993', '426398', '510510', '676770'];
const FRAUD_MERCHANTS = [
  'LuxeGoods Intl',
  'QuickCash Online',
  'CryptoXpress',
  'Global Gift Cards',
  'Prime Electronics HK',
];

const FRAUD_RATE = 0.1;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StreamOptions {
  seed?: number;
  /** Epoch ms the stream clock starts at. Defaults to GENESIS_TIME for reproducibility. */
  startTime?: number;
}

export interface TransactionStream extends Iterable<Transaction> {
  users: UserProfile[];
  baselines: Map<string, UserBaseline>;
  nextTransaction(): Transaction;
  generateBatch(n: number): Transaction[];
}

export function createTransactionStream(options: StreamOptions = {}): TransactionStream {
  const rand = mulberry32(options.seed ?? DEFAULT_SEED);
  let clock = options.startTime ?? GENESIS_TIME;
  let counter = 0;
  /** Pending burst transactions queued to be emitted next. */
  const queue: Transaction[] = [];

  const baselines = new Map<string, UserBaseline>(
    USERS.map((u) => [u.baseline.userId, u.baseline]),
  );

  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

  /** Standard normal via Box–Muller, driven by the seeded PRNG. */
  const gaussian = () => {
    const u = Math.max(rand(), 1e-9);
    const v = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const nextId = () => `txn-${String(++counter).padStart(5, '0')}`;

  const makeTxn = (user: UserProfile, overrides: Partial<Transaction> = {}): Transaction => ({
    id: nextId(),
    userId: user.baseline.userId,
    amount: round2(Math.max(1.5, user.baseline.avgAmount + gaussian() * user.baseline.stdevAmount)),
    currency: user.currency,
    timestamp: clock,
    merchant: pick(user.merchants),
    category: pick(user.categories),
    country: user.baseline.usualCountry,
    cardBin: user.cardBin,
    ...overrides,
  });

  /** Move the emitted timestamp to 02:00–04:59 UTC on the same date. */
  const nightTimestamp = () => {
    const d = new Date(clock);
    return Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      2 + Math.floor(rand() * 3),
      Math.floor(rand() * 60),
      Math.floor(rand() * 60),
    );
  };

  const makeFraudTxns = (user: UserProfile): Transaction[] => {
    const { avgAmount } = user.baseline;
    const roll = rand();

    if (roll < 0.3) {
      // Big spend: 6–15x the user's average at a suspicious merchant.
      return [
        makeTxn(user, {
          amount: round2(avgAmount * (6 + rand() * 9)),
          merchant: pick(FRAUD_MERCHANTS),
          category: 'retail',
        }),
      ];
    }
    if (roll < 0.55) {
      // Foreign country + foreign card + elevated amount.
      return [
        makeTxn(user, {
          amount: round2(avgAmount * (2 + rand() * 3)),
          country: pick(FRAUD_COUNTRIES),
          cardBin: pick(FRAUD_BINS),
          merchant: pick(FRAUD_MERCHANTS),
          category: 'retail',
        }),
      ];
    }
    if (roll < 0.8) {
      // Card-testing burst: 4 rapid transactions within seconds.
      const merchant = pick(FRAUD_MERCHANTS);
      const txns: Transaction[] = [];
      let ts = clock;
      for (let i = 0; i < 4; i++) {
        txns.push(
          makeTxn(user, {
            amount: round2(Math.max(1.5, avgAmount * (0.8 + rand() * 1.5))),
            merchant,
            category: 'retail',
            timestamp: ts,
          }),
        );
        ts += 3_000 + Math.floor(rand() * 5_000);
      }
      clock = ts;
      return txns;
    }
    // Night spend: 3–8x average at 2–4am UTC.
    return [
      makeTxn(user, {
        amount: round2(avgAmount * (3 + rand() * 5)),
        merchant: pick(FRAUD_MERCHANTS),
        category: 'retail',
        timestamp: nightTimestamp(),
      }),
    ];
  };

  const nextTransaction = (): Transaction => {
    const queued = queue.shift();
    if (queued) return queued;

    // 10-30s of simulated time per transaction: with 8 users this keeps a
    // user's normal cadence (~2-4 min) well outside the velocity window,
    // so only genuine bursts (seconds apart) trip the velocity signal.
    clock += 10_000 + Math.floor(rand() * 20_000);
    const user = pick(USERS);

    if (rand() < FRAUD_RATE) {
      const [first, ...rest] = makeFraudTxns(user);
      queue.push(...rest);
      return first;
    }
    return makeTxn(user);
  };

  return {
    users: USERS,
    baselines,
    nextTransaction,
    generateBatch: (n: number) => Array.from({ length: n }, nextTransaction),
    *[Symbol.iterator]() {
      // Infinite iterator — consumers must bound their own iteration.
      for (;;) yield nextTransaction();
    },
  };
}
