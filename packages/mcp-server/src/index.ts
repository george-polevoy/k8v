import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerConnectionTools } from './mcpConnectionTools.js';
import { registerDocumentationResources } from './mcpDocumentationResources.js';
import { registerGraphTools } from './mcpGraphTools.js';
import {
  getGraph,
} from './mcpGraphClient.js';
import { registerRuntimeTools } from './mcpRuntimeTools.js';
import {
  resolveBackendUrl,
  resolveFrontendUrl,
} from './mcpHttp.js';
export {
  GraphCommand,
  GraphQueryRequestSchema,
} from '../../domain/dist/index.js';

export { renderGraphRegionScreenshotFromFrontend } from './frontendScreenshot.js';
export { filterConnections } from '../../domain/dist/index.js';

const server: any = new McpServer({
  name: 'k8v-mcp-server',
  version: '0.1.0',
});

registerDocumentationResources(server);

registerConnectionTools(server, {
  resolveBackendUrl,
  getGraph,
});

registerGraphTools(server, {
  resolveBackendUrl,
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
