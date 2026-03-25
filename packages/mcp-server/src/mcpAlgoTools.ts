import { z } from 'zod';
import { requestJson, textResult } from './mcpHttp.js';

interface AlgoToolRegistrarDeps {
  resolveBackendUrl: (backendUrl?: string) => string;
}

interface AlgoInjectionSummary {
  id: string;
  name: string;
  artifactId: string;
  entrypoint: string;
  abi: string;
  createdAt: number;
  updatedAt: number;
}

async function resolveAlgoInjectionId(params: {
  backendUrl: string;
  graphId: string;
  algoId?: string;
  algoName?: string;
}): Promise<string> {
  if (params.algoId) {
    return params.algoId;
  }
  if (!params.algoName) {
    throw new Error('Expected either algoId or algoName');
  }

  const response = await requestJson<{ algoInjections: AlgoInjectionSummary[] }>(
    params.backendUrl,
    `/api/graphs/${encodeURIComponent(params.graphId)}/algos`
  );
  const match = response.algoInjections.find((candidate) => candidate.name === params.algoName);
  if (!match) {
    throw new Error(`Algo injection "${params.algoName}" was not found in graph ${params.graphId}`);
  }
  return match.id;
}

export function registerAlgoTools(server: any, deps: AlgoToolRegistrarDeps): void {
  const { resolveBackendUrl } = deps;

  server.registerTool(
    'algo_injection_list',
    {
      description: 'List graph-scoped wasm algo injections.',
      inputSchema: {
        graphId: z.string(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const response = await requestJson<{ algoInjections: AlgoInjectionSummary[] }>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/algos`
      );
      return textResult(response);
    }
  );

  server.registerTool(
    'algo_injection_register',
    {
      description:
        'Register a graph-scoped wasm algo injection from base64-encoded wasm bytes. ' +
        'The module must export memory, alloc, and a JSON entrypoint (default `run`).',
      inputSchema: {
        graphId: z.string(),
        name: z.string().min(1),
        wasmBase64: z.string().min(1),
        entrypoint: z.string().min(1).optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, name, wasmBase64, entrypoint, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const response = await requestJson<unknown>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/algos`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            wasmBase64,
            entrypoint,
          }),
        }
      );
      return textResult(response);
    }
  );

  server.registerTool(
    'algo_injection_delete',
    {
      description: 'Delete a graph-scoped wasm algo injection by id or name.',
      inputSchema: {
        graphId: z.string(),
        algoId: z.string().optional(),
        algoName: z.string().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, algoId, algoName, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const resolvedAlgoId = await resolveAlgoInjectionId({
        backendUrl: resolvedBackendUrl,
        graphId,
        algoId,
        algoName,
      });
      const response = await requestJson<unknown>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/algos/${encodeURIComponent(resolvedAlgoId)}`,
        {
          method: 'DELETE',
        }
      );
      return textResult(response);
    }
  );

  server.registerTool(
    'algo_injection_run',
    {
      description:
        'Run a graph-scoped wasm algo injection with arbitrary JSON input. ' +
        'Inside the module, graph_get, graph_query, and staged bulk_edit are available through the fixed host API.',
      inputSchema: {
        graphId: z.string(),
        algoId: z.string().optional(),
        algoName: z.string().optional(),
        input: z.unknown().optional(),
        noRecompute: z.boolean().optional(),
        backendUrl: z.string().optional(),
      },
    },
    async ({ graphId, algoId, algoName, input, noRecompute, backendUrl }) => {
      const resolvedBackendUrl = resolveBackendUrl(backendUrl);
      const resolvedAlgoId = await resolveAlgoInjectionId({
        backendUrl: resolvedBackendUrl,
        graphId,
        algoId,
        algoName,
      });
      const response = await requestJson<unknown>(
        resolvedBackendUrl,
        `/api/graphs/${encodeURIComponent(graphId)}/algos/${encodeURIComponent(resolvedAlgoId)}/invoke`,
        {
          method: 'POST',
          body: JSON.stringify({
            input,
            noRecompute,
          }),
        }
      );
      return textResult(response);
    }
  );
}
