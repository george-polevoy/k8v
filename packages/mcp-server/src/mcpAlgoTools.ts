import { z } from 'zod';
import { requestJson, textResult } from './mcpHttp.js';

interface AlgoToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
}

export function registerAlgoTools(server: any, deps: AlgoToolRegistrarDeps): void {
  const { resolveBackendUrl } = deps;

  server.registerTool(
    'algo_injection_run',
    {
      description:
        'Run a wasm algo from an absolute filesystem path accessible to the backend host. ' +
        'The module must export memory, alloc, and a JSON entrypoint (default `run`). ' +
        'Inside the module, graph_get, graph_query, and staged bulk_edit are available through the fixed host API.',
      inputSchema: {
        graphId: z.string(),
        wasmPath: z.string().min(1),
        entrypoint: z.string().min(1).optional(),
        input: z.unknown().optional(),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, wasmPath, entrypoint, input, noRecompute, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const response = await requestJson<unknown>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/algo/invoke`,
        {
          method: 'POST',
          body: JSON.stringify({
            wasmPath,
            entrypoint,
            input,
            noRecompute,
          }),
        }
      );
      return textResult(response);
    }
  );
}
