import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerNodeTools } from './mcpNodeTools.js';
import { registerConnectionTools } from './mcpConnectionTools.js';
import { registerDrawingTools } from './mcpDrawingTools.js';
import { registerGraphTools } from './mcpGraphTools.js';
import {
  getGraph,
  updateGraph,
  updateGraphConnections,
  updateGraphConnectionsWithResult,
} from './mcpGraphClient.js';
import { registerRuntimeTools } from './mcpRuntimeTools.js';
import {
  resolveBackendUrl,
  resolveFrontendUrl,
} from './mcpHttp.js';

export { renderGraphRegionScreenshotFromFrontend } from './frontendScreenshot.js';
export {
  applyBulkEditOperation,
  BULK_EDIT_OPERATION_SCHEMA,
} from './graphEdits.js';
export {
  filterConnections,
} from './graphConnectionEdits.js';
export { GRAPH_QUERY_OPERATION_SCHEMA } from './mcpGraphTools.js';

const server: any = new McpServer({
  name: 'k8v-mcp-server',
  version: '0.1.0',
});

registerDrawingTools(server, {
  resolveBackendUrl,
  updateGraph,
});

registerNodeTools(server, {
  resolveBackendUrl,
  updateGraph,
});

registerConnectionTools(server, {
  resolveBackendUrl,
  getGraph,
  updateGraphConnections,
  updateGraphConnectionsWithResult,
});

registerGraphTools(server, {
  resolveBackendUrl,
  getGraph,
  updateGraph,
});

registerRuntimeTools(server, {
  resolveBackendUrl,
  resolveFrontendUrl,
  getGraph,
});

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const directRunCandidate = process.argv[1];
const isDirectRun = directRunCandidate
  ? pathToFileURL(directRunCandidate).href === import.meta.url
  : false;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
