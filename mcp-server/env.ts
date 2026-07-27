/**
 * SentinelFraud MCP — minimal .env.local loader.
 *
 * Loads env vars (GEMINI_API_KEY, MCP_AUTH_TOKEN, EXPOSE_RAW_SCORE, ...) from
 * the project's .env.local when present, so `npm run mcp` / `npm run mcp:remote`
 * and Claude Desktop launches pick them up without extra configuration. Real
 * environment variables always win, and values are never logged. A missing
 * file is fine.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadLocalEnv(): void {
  try {
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const content = readFileSync(resolve(projectRoot, '.env.local'), 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // No .env.local — nothing to load.
  }
}
