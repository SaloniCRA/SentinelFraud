/**
 * SentinelFraud — synthetic transaction stream.
 *
 * Seeds 8 users with realistic baselines and emits a rolling stream of
 * transactions, ~10% of which are fraudulent. Fraud patterns exercise every
 * engine signal: large amounts, foreign countries, rapid bursts, 3am
 * timestamps, anonymizing-network IPs, disposable emails, and impossible
 * travel (a home-country charge immediately followed by one continents away).
 *
 * Uses a seedable PRNG (mulberry32) so runs are fully reproducible: two
 * streams created with the same seed and startTime produce identical batches,
 * which the unit tests rely on.
 *
 * IP addresses are drawn from a bundled demo pool (see lib/enrichment/ip.ts
 * DEMO_IP_MAP) so geolocation resolves offline and deterministically.
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
  /** Demo "home" IP whose country matches the user's usual country. */
  homeIp: string;
  /** Non-disposable email domain the user normally transacts with. */
  emailDomain: string;
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
  homeIp: string,
  emailDomain: string,
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
  homeIp,
  emailDomain,
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
    '198.51.100.11',
    'gmail.com',
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
    '198.51.100.11',
    'outlook.com',
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
    '198.51.100.24',
    'bt-mail.example',
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
    '198.51.100.37',
    'web.example',
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
    '198.51.100.11',
    'icloud.com',
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
    '198.51.100.48',
    'gmail.com',
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
    '198.51.100.53',
    'gmail.com',
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
    '198.51.100.66',
    'bigpond.example',
    ['Woolworths', 'Bunnings', 'Opal Transport', 'JB Hi-Fi'],
    ['groceries', 'home', 'transport', 'electronics'],
  ),
];

/** Foreign fraud origins: country + matching demo IP (see DEMO_IP_MAP). */
const FRAUD_ORIGINS: { country: string; ip: string }[] = [
  { country: 'RO', ip: '203.0.113.9' },
  { country: 'NG', ip: '203.0.113.22' },
  { country: 'VN', ip: '203.0.113.41' },
  { country: 'BR', ip: '203.0.113.58' },
  { country: 'UA', ip: '203.0.113.77' },
  { country: 'PH', ip: '203.0.113.90' },
];

/** Demo IPs flagged as proxy/VPN/hosting in DEMO_IP_MAP. */
const ANON_IPS = ['203.0.113.9', '203.0.113.41', '203.0.113.77', '203.0.113.90'];

const FRAUD_BINS = ['531993', '426398', '510510', '676770'];
const FRAUD_MERCHANTS = [
  'LuxeGoods Intl',
  'QuickCash Online',
  'CryptoXpress',
  'Global Gift Cards',
  'Prime Electronics HK',
];
const FRAUD_EMAIL_DOMAINS = [
  'mailinator.com',
  'guerrillamail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
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
  /** Pending burst/paired transactions queued to be emitted next. */
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
  const fraudEmail = () => `acct-${Math.floor(rand() * 1_000_000)}@${pick(FRAUD_EMAIL_DOMAINS)}`;

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
    ip: user.homeIp,
    email: `${user.baseline.userId.replace(/-/g, '')}@${user.emailDomain}`,
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

    if (roll < 0.25) {
      // Big spend: 6–15x the user's average at a suspicious merchant.
      return [
        makeTxn(user, {
          amount: round2(avgAmount * (6 + rand() * 9)),
          merchant: pick(FRAUD_MERCHANTS),
          category: 'retail',
        }),
      ];
    }
    if (roll < 0.5) {
      // Account takeover: home country/card, but the request originates from a
      // foreign anonymizing network with a disposable email (2–4x amount).
      return [
        makeTxn(user, {
          amount: round2(avgAmount * (2 + rand() * 2)),
          merchant: pick(FRAUD_MERCHANTS),
          category: 'retail',
          ip: pick(ANON_IPS),
          email: fraudEmail(),
        }),
      ];
    }
    if (roll < 0.7) {
      // Card-testing burst: 4 rapid txns via an anonymizing IP + disposable email.
      const merchant = pick(FRAUD_MERCHANTS);
      const ip = pick(ANON_IPS);
      const email = fraudEmail();
      const txns: Transaction[] = [];
      let ts = clock;
      for (let i = 0; i < 4; i++) {
        txns.push(
          makeTxn(user, {
            amount: round2(Math.max(1.5, avgAmount * (0.8 + rand() * 1.5))),
            merchant,
            category: 'retail',
            ip,
            email,
            timestamp: ts,
          }),
        );
        ts += 3_000 + Math.floor(rand() * 5_000);
      }
      clock = ts;
      return txns;
    }
    if (roll < 0.85) {
      // Night spend: 3–8x average at 2–4am UTC.
      return [
        makeTxn(user, {
          amount: round2(avgAmount * (3 + rand() * 5)),
          merchant: pick(FRAUD_MERCHANTS),
          category: 'retail',
          timestamp: nightTimestamp(),
        }),
      ];
    }
    // Impossible travel: a normal home charge, then minutes later a charge from
    // a foreign country/IP — a physically impossible relocation.
    const home = makeTxn(user);
    clock += 120_000 + Math.floor(rand() * 180_000); // 2–5 minutes later
    const origin = pick(FRAUD_ORIGINS);
    const abroad = makeTxn(user, {
      amount: round2(avgAmount * (2 + rand() * 4)),
      merchant: pick(FRAUD_MERCHANTS),
      category: 'retail',
      country: origin.country,
      cardBin: pick(FRAUD_BINS), // stolen, foreign-issued card
      ip: origin.ip,
      email: fraudEmail(),
    });
    return [home, abroad];
  };

  const nextTransaction = (): Transaction => {
    const queued = queue.shift();
    if (queued) return queued;

    // 10-30s of simulated time per transaction: with 8 users this keeps a
    // user's normal cadence (~2-4 min) well outside the velocity window, so
    // only genuine bursts (seconds apart) trip the velocity signal.
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
