import {
  GraphNode,
  Graph,
  NodeType,
  ComputationResult,
  DataSchema,
  DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS,
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
      case NodeType.LIBRARY:
        outputs = await this.executeLibraryNode(node, inputs);
        break;
      case NodeType.SUBGRAPH:
        outputs = await this.executeSubgraph(node, inputs);
        break;
      case NodeType.EXTERNAL_INPUT:
        outputs = await this.executeExternalInput(node, inputs);
        break;
      case NodeType.NUMERIC_INPUT:
        outputs = await this.executeNumericInput(node);
        break;
      case NodeType.EXTERNAL_OUTPUT:
        outputs = await this.executeExternalOutput(node, inputs);
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
   * Execute library node
   */
  private async executeLibraryNode(node: GraphNode, _inputs: Record<string, any>): Promise<Record<string, any>> {
    if (!node.config.libraryId) {
      throw new Error(`Library node ${node.id} has no libraryId`);
    }

    const library = await this.dataStore.getLibraryNode(node.config.libraryId);
    if (!library) {
      throw new Error(`Library node ${node.config.libraryId} not found`);
    }

    // Execute library node logic
    // This would call the library's execution function
    // For now, return a placeholder
    return {
      result: `Library node ${library.name} executed with inputs`,
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

    // Map inputs to external input nodes in subgraph
    const externalInputNodes = subgraph.nodes.filter(
      (n: GraphNode) => n.config.type === NodeType.EXTERNAL_INPUT
    );

    for (const inputNode of externalInputNodes) {
      // Set inputs on external input nodes
      // This would be handled by the graph engine
      void inputNode; // Placeholder to prevent unused variable warning
    }

    // Execute subgraph (would use GraphEngine)
    // For now, return placeholder
    return {
      result: `Subgraph ${node.config.subgraphId} executed`,
    };
  }

  /**
   * Execute external input node
   */
  private async executeExternalInput(node: GraphNode, inputs: Record<string, any>): Promise<Record<string, any>> {
    // External input nodes pass through their configured inputs
    const outputs: Record<string, any> = {};
    for (const output of node.metadata.outputs) {
      outputs[output.name] = node.config.config?.[output.name] || inputs[output.name];
    }
    return outputs;
  }

  /**
   * Execute numeric input node
   */
  private async executeNumericInput(node: GraphNode): Promise<Record<string, any>> {
    const { value } = this.resolveNumericInputConfig(node);
    const outputName = node.metadata.outputs[0]?.name ?? 'value';
    return { [outputName]: value };
  }

  /**
   * Execute external output node
   */
  private async executeExternalOutput(node: GraphNode, inputs: Record<string, any>): Promise<Record<string, any>> {
    // External output nodes pass through their inputs as outputs
    return inputs;
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
    const timeoutCandidate = graph?.executionTimeoutMs;
    if (typeof timeoutCandidate === 'number' && Number.isFinite(timeoutCandidate) && timeoutCandidate > 0) {
      return timeoutCandidate;
    }
    return DEFAULT_GRAPH_EXECUTION_TIMEOUT_MS;
  }

  private resolveNumericInputConfig(node: GraphNode): { value: number; min: number; max: number; step: number } {
    const rawConfig = node.config.config ?? {};
    const min = this.toFiniteNumber(rawConfig.min, 0);
    const maxCandidate = this.toFiniteNumber(rawConfig.max, 100);
    const max = maxCandidate >= min ? maxCandidate : min;
    const stepCandidate = this.toFiniteNumber(rawConfig.step, 1);
    const step = stepCandidate > 0 ? stepCandidate : 1;
    const valueCandidate = this.toFiniteNumber(rawConfig.value, min);
    const value = this.snapNumericInputValue(valueCandidate, min, max, step);
    return { value, min, max, step };
  }

  private toFiniteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private snapNumericInputValue(value: number, min: number, max: number, step: number): number {
    if (max <= min) {
      return min;
    }

    const clamped = Math.min(Math.max(value, min), max);
    const steps = Math.round((clamped - min) / step);
    const snapped = min + (steps * step);
    const decimals = this.countStepDecimals(step);
    const rounded = Number(snapped.toFixed(decimals));
    return Math.min(Math.max(rounded, min), max);
  }

  private countStepDecimals(step: number): number {
    if (!Number.isFinite(step) || step <= 0) {
      return 0;
    }

    const text = step.toString().toLowerCase();
    if (text.includes('e-')) {
      const exponent = Number.parseInt(text.split('e-')[1] ?? '0', 10);
      return Number.isFinite(exponent) ? exponent : 0;
    }

    const decimalIndex = text.indexOf('.');
    if (decimalIndex === -1) {
      return 0;
    }

    return text.length - decimalIndex - 1;
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
