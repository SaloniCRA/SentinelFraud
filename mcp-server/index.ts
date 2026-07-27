/**
 * SentinelFraud MCP server (stdio).
 *
 * Exposes the same pure fraud engine used by the dashboard as Model Context
 * Protocol tools over stdio, for local clients (e.g. Claude Desktop). The tool
 * definitions and handlers are shared with the remote server (see tools.ts);
 * this entry only wires them to a stdio transport.
 *
 * Local stdio callers are trusted, so raw numeric scores ARE exposed.
 *
 * Run with: npm run mcp
 *
 * IMPORTANT: stdout carries the MCP protocol — all logging goes to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadLocalEnv } from './env';
import { createSentinelServer } from './tools';

loadLocalEnv();

async function main() {
  const server = createSentinelServer({ exposeRawScore: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  server.onclose = () => process.exit(0);
  console.error('SentinelFraud MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error starting SentinelFraud MCP server:', err);
  process.exit(1);
});
