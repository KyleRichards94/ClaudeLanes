/**
 * Test helpers for the MCP connection test (AL-045). Never imported by production code. The stdio
 * fake is `fake-mcp-server.mjs` in this folder: run it with `node <path>`.
 */
export { startFakeMcpHttpServer, type FakeMcpHttpServer, type FakeMcpHttpServerOptions } from './fake-mcp-http';
