import {
  GraphNode,
  Graph,
  NodeType,
  ComputationResult,
  DataSchema,
  normalizeGraphExecutionTimeoutMs,
  normalizeNumericInputConfig,
} from '../types/index.js';
import { DataStore } from './DataStore.js';
import { DEFAULT_RUNTIME_ID, ExecutionRuntime, PYTHON_RUNTIME_ID } from './execution/types.js';
import { JavaScriptVmRuntime } from './execution/JavaScriptVmRuntime.js';
import { PythonProcessRuntime } from './execution/PythonProcessRuntime.js';

/**
 * Executes nodes and produces computation results
 */
export class NodeExecutor {
  private dataStore: DataStore;
  private runtimes: Map<string, ExecutionRuntime>;
  private defaultRuntimeId: string;

  constructor(
    dataStore: DataStore,
    runtimeOrRegistry?: ExecutionRuntime | Record<string, ExecutionRuntime>,
    defaultRuntimeId: string = DEFAULT_RUNTIME_ID
  ) {
    this.dataStore = dataStore;
    this.defaultRuntimeId = defaultRuntimeId;
    this.runtimes = this.initializeRuntimes(runtimeOrRegistry);
  }

  /**
   * Execute a node with given inputs
   */
  async execute(
    node: GraphNode,
    inputs: Record<string, any>,
    graph?: Graph
  ): Promise<ComputationResult> {
    let outputs: Record<string, any> = {};
    let textOutput: string | undefined;
    let graphicsOutput: string | undefined;

    switch (node.config.type) {
      case NodeType.INLINE_CODE: {
        const result = await this.executeInlineCode(node, inputs, graph);
        outputs = result.outputs;
        textOutput = result.textOutput;
        graphicsOutput = result.graphicsOutput;
        break;
      }
      case NodeType.SUBGRAPH:
        outputs = await this.executeSubgraph(node, inputs);
        break;
      case NodeType.NUMERIC_INPUT:
        outputs = await this.executeNumericInput(node);
        break;
      case NodeType.ANNOTATION:
        outputs = await this.executeAnnotationNode();
        break;
      default:
        throw new Error(`Unknown node type: ${node.config.type}`);
    }

    // Infer schema from outputs
    const schema = this.inferSchema(outputs, node.metadata.outputs);

    return {
      nodeId: node.id,
      outputs,
      schema,
      timestamp: Date.now(),
      version: node.version,
      textOutput,
      graphicsOutput,
    };
  }

  /**
   * Execute inline code node
   */
  private async executeInlineCode(
    node: GraphNode,
    inputs: Record<string, any>,
    graph?: Graph
  ): Promise<{
    outputs: Record<string, any>;
    textOutput?: string;
    graphicsOutput?: string;
  }> {
    if (!node.config.code) {
      throw new Error(`Inline code node ${node.id} has no code`);
    }
    const runtime = this.resolveRuntime(node);
    const pythonExecutionContext = this.resolvePythonExecutionContext(node, graph);
    const runtimeResult = await runtime.execute({
      code: node.config.code,
      inputs,
      timeoutMs: this.resolveTimeoutMs(graph),
      ...pythonExecutionContext,
    });

    return {
      outputs: runtimeResult.outputs,
      textOutput: runtimeResult.textOutput,
      graphicsOutput: runtimeResult.graphicsOutput,
    };
  }

  /**
   * Execute subgraph node
   */
  private async executeSubgraph(node: GraphNode, _inputs: Record<string, any>): Promise<Record<string, any>> {
    if (!node.config.subgraphId) {
      throw new Error(`Subgraph node ${node.id} has no subgraphId`);
    }

    // Get the subgraph
    const subgraph = await this.dataStore.getGraph(node.config.subgraphId);
    if (!subgraph) {
      throw new Error(`Subgraph ${node.config.subgraphId} not found`);
    }

    void subgraph;

    // Reusable subgraph execution is still roadmap-only, so keep a placeholder result.
    return {
      result: `Subgraph ${node.config.subgraphId} executed`,
    };
  }

  /**
   * Execute numeric input node
   */
  private async executeNumericInput(node: GraphNode): Promise<Record<string, any>> {
    const { value } = normalizeNumericInputConfig(
      node.config.config as Record<string, unknown> | undefined
    );
    const outputName = node.metadata.outputs[0]?.name ?? 'value';
    return { [outputName]: value };
  }

  /**
   * Execute annotation node
   */
  private async executeAnnotationNode(): Promise<Record<string, any>> {
    // Annotation nodes are presentation-only and do not produce computation outputs.
    return {};
  }

  /**
   * Infer schema from output data
   */
  private inferSchema(
    outputs: Record<string, any>,
    outputDefinitions: Array<{ name: string; schema: DataSchema }>
  ): Record<string, DataSchema> {
    const schema: Record<string, DataSchema> = {};

    for (const def of outputDefinitions) {
      const value = outputs[def.name];
      schema[def.name] = this.inferValueSchema(value, def.schema);
    }

    return schema;
  }

  /**
   * Infer schema for a single value
   */
  private inferValueSchema(value: any, hint?: DataSchema): DataSchema {
    if (hint) {
      return hint;
    }

    if (value === null || value === undefined) {
      return { type: 'null' };
    }

    if (typeof value === 'string') {
      return { type: 'string' };
    }

    if (typeof value === 'number') {
      return { type: 'number' };
    }

    if (typeof value === 'boolean') {
      return { type: 'boolean' };
    }

    if (Array.isArray(value)) {
      return {
        type: 'array',
        items: value.length > 0 ? this.inferValueSchema(value[0]) : { type: 'null' },
      };
    }

    if (typeof value === 'object') {
      const properties: Record<string, DataSchema> = {};
      for (const [key, val] of Object.entries(value)) {
        properties[key] = this.inferValueSchema(val);
      }
      return {
        type: 'object',
        properties,
      };
    }

    return { type: 'null' };
  }

  private resolveTimeoutMs(graph?: Graph): number {
    return normalizeGraphExecutionTimeoutMs(graph?.executionTimeoutMs);
  }

  private initializeRuntimes(
    runtimeOrRegistry?: ExecutionRuntime | Record<string, ExecutionRuntime>
  ): Map<string, ExecutionRuntime> {
    const builtInRuntimes: Record<string, ExecutionRuntime> = {
      [DEFAULT_RUNTIME_ID]: new JavaScriptVmRuntime(),
      [PYTHON_RUNTIME_ID]: new PythonProcessRuntime(),
    };

    if (!runtimeOrRegistry) {
      return new Map(Object.entries(builtInRuntimes));
    }

    if (this.isExecutionRuntime(runtimeOrRegistry)) {
      return new Map(
        Object.entries({
          ...builtInRuntimes,
          [this.defaultRuntimeId]: runtimeOrRegistry,
        })
      );
    }

    const runtimeRegistry: Record<string, ExecutionRuntime> = {
      ...builtInRuntimes,
      ...runtimeOrRegistry,
    };
    return new Map(Object.entries(runtimeRegistry));
  }

  private isExecutionRuntime(
    runtimeOrRegistry: ExecutionRuntime | Record<string, ExecutionRuntime>
  ): runtimeOrRegistry is ExecutionRuntime {
    return typeof (runtimeOrRegistry as ExecutionRuntime).execute === 'function';
  }

  private resolveRuntime(node: GraphNode): ExecutionRuntime {
    const runtimeId = node.config.runtime ?? this.defaultRuntimeId;

    if (node.config.pythonEnv && runtimeId !== PYTHON_RUNTIME_ID) {
      throw new Error(
        `Node ${node.id} sets pythonEnv '${node.config.pythonEnv}' but runtime '${runtimeId}' is not '${PYTHON_RUNTIME_ID}'`
      );
    }

    const runtime = this.runtimes.get(runtimeId);

    if (!runtime) {
      throw new Error(`Execution runtime '${runtimeId}' is not registered`);
    }

    return runtime;
  }

  private resolvePythonExecutionContext(
    node: GraphNode,
    graph?: Graph
  ): { pythonBin?: string; cwd?: string } {
    if ((node.config.runtime ?? this.defaultRuntimeId) !== PYTHON_RUNTIME_ID) {
      return {};
    }

    const envName = node.config.pythonEnv;
    if (!envName) {
      return {};
    }

    if (!graph) {
      throw new Error(
        `Node ${node.id} references python environment '${envName}' but no graph context was provided`
      );
    }

    const pythonEnvironment = (graph.pythonEnvs ?? []).find((candidate) => candidate.name === envName);
    if (!pythonEnvironment) {
      throw new Error(`Node ${node.id} references unknown python environment '${envName}'`);
    }

    return {
      pythonBin: pythonEnvironment.pythonPath,
      cwd: pythonEnvironment.cwd,
    };
  }
}
