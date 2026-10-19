import { McpServer } from '@modelcontextprotocol/server';
import { PGMOAT_VERSION } from '../version.js';
import { registerTools } from '../tools/register.js';
import { buildInstructions } from './instructions.js';
import type { ToolDeps } from '../tools/context.js';

/**
 * Creates and configures an MCP server instance with the five core tools
 * registered in fixed order and server-level instructions populated.
 *
 * Spec reference: spec/03 section 10.1; spec/02 F4
 */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: deps.config.server.name, version: PGMOAT_VERSION },
    {
      capabilities: { tools: {} },
      instructions: buildInstructions(deps.config),
    },
  );

  registerTools(server, deps);
  return server;
}
