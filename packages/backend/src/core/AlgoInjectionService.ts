import { randomUUID } from 'node:crypto';
import {
  Graph,
  GraphAlgoInjection,
  type GraphCommand,
  type GraphRuntimeState,
  normalizeGraphExecutionTimeoutMs,
  type Graph as GraphType,
  type GraphAlgoInjection as GraphAlgoInjectionType,
} from '../types/index.js';
import { GraphCommandService, GraphRevisionConflictError } from './GraphCommandService.js';
import { GraphEventBroker } from './GraphEventBroker.js';
import { DataStore } from './DataStore.js';
import { validateGraphStructure } from './graphValidation.js';
import { runWasmAlgoSandbox, WasmAlgoSandboxError } from './algo/WasmAlgoSandbox.js';
import {
  DEFAULT_ALGO_INJECTION_ENTRYPOINT,
  validateWasmAlgoBinary,
  WasmAlgoValidationError,
} from './algo/wasmAlgoValidation.js';

const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;
const ALGO_INJECTION_ID_PREFIX = 'algo_';

export class AlgoInjectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlgoInjectionValidationError';
  }
}

export class AlgoInjectionExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlgoInjectionExecutionError';
  }
}

export class AlgoInjectionService {
  constructor(
    private readonly dataStore: DataStore,
    private readonly graphCommandService: GraphCommandService,
    private readonly eventBroker: GraphEventBroker,
  ) {}

  async listAlgoInjections(graphId: string): Promise<GraphAlgoInjectionType[]> {
    return [...(await this.requireGraph(graphId)).algoInjections];
  }

  async registerAlgoInjection(params: {
    graphId: string;
    name: string;
    wasmBase64: string;
    entrypoint?: string;
  }): Promise<{ graph: GraphType; algoInjection: GraphAlgoInjectionType }> {
    const graph = await this.requireGraph(params.graphId);
    const name = params.name.trim();
    const entrypoint = (params.entrypoint ?? DEFAULT_ALGO_INJECTION_ENTRYPOINT).trim();
    if (!name) {
      throw new AlgoInjectionValidationError('Algo injection name must not be empty');
    }
    if (!entrypoint) {
      throw new AlgoInjectionValidationError('Algo injection entrypoint must not be empty');
    }
    if (graph.algoInjections.some((candidate) => candidate.name === name)) {
      throw new AlgoInjectionValidationError(`Algo injection "${name}" already exists in graph ${graph.id}`);
    }

    const wasmBuffer = decodeBase64(params.wasmBase64);
    try {
      await validateWasmAlgoBinary(wasmBuffer, entrypoint);
    } catch (error) {
      if (error instanceof WasmAlgoValidationError) {
        throw new AlgoInjectionValidationError(error.message);
      }
      throw error;
    }

    const artifact = await this.dataStore.storeWasmArtifact(wasmBuffer);
    const now = Date.now();
    const algoInjection = GraphAlgoInjection.parse({
      id: `${ALGO_INJECTION_ID_PREFIX}${randomUUID()}`,
      name,
      artifactId: artifact.id,
      entrypoint,
      abi: 'json_v1',
      createdAt: now,
      updatedAt: now,
    });

    try {
      const nextGraph = await this.persistGraphMetadataUpdate(graph, (current) => ({
        ...current,
        algoInjections: [...current.algoInjections, algoInjection],
      }));
      return {
        graph: nextGraph,
        algoInjection,
      };
    } catch (error) {
      await this.dataStore.deleteWasmArtifact(artifact.id);
      throw error;
    }
  }

  async deleteAlgoInjection(params: {
    graphId: string;
    algoId: string;
  }): Promise<{ graph: GraphType; deletedAlgoInjection: GraphAlgoInjectionType }> {
    const graph = await this.requireGraph(params.graphId);
    const algoInjection = graph.algoInjections.find((candidate) => candidate.id === params.algoId);
    if (!algoInjection) {
      throw new Error(`Algo injection ${params.algoId} was not found in graph ${graph.id}`);
    }

    const nextGraph = await this.persistGraphMetadataUpdate(graph, (current) => ({
      ...current,
      algoInjections: current.algoInjections.filter((candidate) => candidate.id !== params.algoId),
    }));
    await this.dataStore.deleteWasmArtifact(algoInjection.artifactId);
    return {
      graph: nextGraph,
      deletedAlgoInjection: algoInjection,
    };
  }

  async invokeAlgoInjection(params: {
    graphId: string;
    algoId: string;
    input: unknown;
    noRecompute?: boolean;
  }): Promise<{
    algoInjection: GraphAlgoInjectionType;
    result: unknown;
    stagedCommands: GraphCommand[];
    graph: GraphType;
    runtimeState: GraphRuntimeState;
  }> {
    const graph = await this.requireGraph(params.graphId);
    const algoInjection = graph.algoInjections.find((candidate) => candidate.id === params.algoId);
    if (!algoInjection) {
      throw new Error(`Algo injection ${params.algoId} was not found in graph ${graph.id}`);
    }

    const artifact = await this.dataStore.getWasmArtifact(algoInjection.artifactId);
    if (!artifact) {
      throw new Error(
        `Algo injection ${algoInjection.id} references missing wasm artifact ${algoInjection.artifactId}`
      );
    }

    let sandboxResult;
    try {
      sandboxResult = await runWasmAlgoSandbox({
        graph,
        wasm: artifact.buffer,
        entrypoint: algoInjection.entrypoint,
        input: params.input,
        timeoutMs: normalizeGraphExecutionTimeoutMs(graph.executionTimeoutMs),
      });
    } catch (error) {
      if (error instanceof WasmAlgoSandboxError) {
        throw new AlgoInjectionExecutionError(error.message);
      }
      throw error;
    }

    if (sandboxResult.stagedCommands.length === 0) {
      return {
        algoInjection,
        result: sandboxResult.result,
        stagedCommands: sandboxResult.stagedCommands,
        graph,
        runtimeState: await this.graphCommandService.buildRuntimeState(graph),
      };
    }

    const commandResponse = await this.graphCommandService.executeCommands(
      graph.id,
      graph.revision,
      sandboxResult.stagedCommands,
      {
        noRecompute: params.noRecompute,
      }
    );

    return {
      algoInjection,
      result: sandboxResult.result,
      stagedCommands: sandboxResult.stagedCommands,
      graph: commandResponse.graph,
      runtimeState: commandResponse.runtimeState,
    };
  }

  private async requireGraph(graphId: string): Promise<GraphType> {
    const graph = await this.dataStore.getGraph(graphId);
    if (!graph) {
      throw new Error(`Graph ${graphId} not found`);
    }
    return graph;
  }

  private async persistGraphMetadataUpdate(
    currentGraph: GraphType,
    mutate: (currentGraph: GraphType) => GraphType
  ): Promise<GraphType> {
    const latestGraph = await this.dataStore.getGraph(currentGraph.id);
    if (!latestGraph) {
      throw new Error(`Graph ${currentGraph.id} not found`);
    }
    if (latestGraph.revision !== currentGraph.revision) {
      throw new GraphRevisionConflictError(latestGraph.revision);
    }

    const candidate = mutate(structuredClone(currentGraph));
    const nextGraph = Graph.parse({
      ...candidate,
      revision: currentGraph.revision + 1,
      updatedAt: Date.now(),
      algoInjections: candidate.algoInjections ?? [],
    });
    const validationError = validateGraphStructure(nextGraph);
    if (validationError) {
      throw new AlgoInjectionValidationError(validationError);
    }

    await this.dataStore.storeGraph(nextGraph);
    this.eventBroker.publish({
      type: 'graph.revised',
      graphId: nextGraph.id,
      revision: nextGraph.revision,
      updatedAt: nextGraph.updatedAt,
    });
    return nextGraph;
  }
}

function decodeBase64(raw: string): Buffer {
  const normalized = raw.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw new AlgoInjectionValidationError('Algo injection wasm payload must be valid base64');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.byteLength === 0) {
    throw new AlgoInjectionValidationError('Algo injection wasm payload decoded to an empty buffer');
  }
  return buffer;
}

export {
  GraphRevisionConflictError,
};
