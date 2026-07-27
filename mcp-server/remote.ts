/**
 * SentinelFraud remote MCP server (Streamable HTTP).
 *
 * Exposes the same four tools as the stdio server over an authenticated HTTP
 * endpoint, so agents can call the fraud engine remotely — but only with a
 * valid bearer token. This satisfies the paper's requirement that
 * "agent-callable must mean authenticated."
 *
 * Security boundary:
 *  - Every request must carry `Authorization: Bearer <MCP_AUTH_TOKEN>`.
 *    Missing/invalid → 401 with a WWW-Authenticate hint. (See the README for
 *    swapping this bearer check for a full OAuth 2.1 provider.)
 *  - Callers are rate-limited (fixed window) → 429 when exceeded.
 *  - Raw numeric scores are hidden by default (EXPOSE_RAW_SCORE=false): remote
 *    callers get band + reasons only, so the engine can't be probed as a
 *    threshold oracle. Set EXPOSE_RAW_SCORE=true only for trusted deployments.
 *
 * Run with: npm run mcp:remote
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadLocalEnv } from './env';
import { createSentinelServer } from './tools';
import { createRateLimiter } from './rate-limit';

loadLocalEnv();

const PORT = Number(process.env.MCP_REMOTE_PORT ?? 8848);
const CONFIGURED_TOKEN = process.env.MCP_AUTH_TOKEN;
const TOKEN = CONFIGURED_TOKEN || 'sentinel-dev-token';
const EXPOSE_RAW_SCORE = process.env.EXPOSE_RAW_SCORE === 'true';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const limiter = createRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function bearerToken(req: IncomingMessage): string {
  const header = req.headers['authorization'] ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

const httpServer = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];

  // Unauthenticated liveness probe.
  if (req.method === 'GET' && path === '/health') {
    return sendJson(res, 200, { status: 'ok', exposeRawScore: EXPOSE_RAW_SCORE });
  }

  if (path !== '/mcp') {
    return sendJson(res, 404, { error: 'not_found', message: 'POST MCP requests to /mcp' });
  }

  // --- Auth boundary: constant-ish bearer check ---
  const provided = bearerToken(req);
  if (!provided || provided !== TOKEN) {
    return sendJson(
      res,
      401,
      { error: 'unauthorized', message: 'a valid Bearer token is required' },
      { 'WWW-Authenticate': 'Bearer realm="sentinelfraud"' },
    );
  }

  // --- Rate limit (per token) ---
  if (limiter.check(provided, Date.now())) {
    return sendJson(res, 429, { error: 'rate_limited', message: 'too many requests' });
  }

  // --- MCP over Streamable HTTP (stateless) ---
  try {
    const body = await readBody(req);
    const server = createSentinelServer({ exposeRawScore: EXPOSE_RAW_SCORE });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
});

httpServer.listen(PORT, () => {
  console.error(`SentinelFraud remote MCP server listening on http://localhost:${PORT}/mcp`);
  console.error(`  raw score exposure: ${EXPOSE_RAW_SCORE ? 'ON' : 'OFF (band + reasons only)'}`);
  console.error(
    `  rate limit: ${RATE_LIMIT_MAX} requests / ${RATE_LIMIT_WINDOW_MS / 1000}s per token`,
  );
  if (!CONFIGURED_TOKEN) {
    console.error(
      '  WARNING: MCP_AUTH_TOKEN not set — using the insecure default "sentinel-dev-token". ' +
        'Set MCP_AUTH_TOKEN before exposing this server.',
    );
  }
});
