import { GraphNode, NodeType, ComputationResult, DataSchema } from '../types/index.js';
import { DataStore } from './DataStore.js';

/**
 * Executes nodes and produces computation results
 */
export class NodeExecutor {
  private dataStore: DataStore;

  constructor(dataStore: DataStore) {
    this.dataStore = dataStore;
  }

  /**
   * Execute a node with given inputs
   */
  async execute(node: GraphNode, inputs: Record<string, any>): Promise<ComputationResult> {
    let outputs: Record<string, any> = {};
    let textOutput: string | undefined;
    let graphicsOutput: string | undefined;

    switch (node.config.type) {
      case NodeType.INLINE_CODE: {
        const result = await this.executeInlineCode(node, inputs);
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
      case NodeType.EXTERNAL_OUTPUT:
        outputs = await this.executeExternalOutput(node, inputs);
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
  private async executeInlineCode(node: GraphNode, inputs: Record<string, any>): Promise<{
    outputs: Record<string, any>;
    textOutput?: string;
    graphicsOutput?: string;
  }> {
    if (!node.config.code) {
      throw new Error(`Inline code node ${node.id} has no code`);
    }

    // Capture stdout/stderr
    const textOutputLines: string[] = [];
    const graphicsOutputs: string[] = [];

    // Create a safe execution context
    const context = {
      inputs,
      outputs: {} as Record<string, any>,
      // Capture console.log, console.error, etc.
      log: (...args: any[]) => {
        textOutputLines.push(args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
      },
      print: (...args: any[]) => {
        textOutputLines.push(args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '));
      },
      // Helper to output graphics (base64 image data)
      outputGraphics: (data: string) => {
        graphicsOutputs.push(data);
      },
      // Helper to output images from canvas or image data
      outputImage: (imageData: string) => {
        graphicsOutputs.push(imageData);
      },
    };

    // Execute code in a sandboxed context
    // WARNING: Using eval() is a security risk. In production, replace with:
    // - vm2 (Node.js VM wrapper)
    // - isolated-vm (V8 isolates)
    // - Docker containers for complete isolation
    try {
      const code = `
        (function() {
          ${node.config.code}
          return outputs;
        })()
      `;

      // SECURITY WARNING: eval() allows arbitrary code execution
      // This should be replaced with a proper sandbox in production
      // eslint-disable-next-line no-eval
      const result = eval(code).call(context);
      const outputs = result || context.outputs;

      return {
        outputs,
        textOutput: textOutputLines.length > 0 ? textOutputLines.join('\n') : undefined,
        graphicsOutput: graphicsOutputs.length > 0 ? graphicsOutputs[graphicsOutputs.length - 1] : undefined,
      };
    } catch (error: any) {
      // Include error in text output
      const errorMessage = `Error: ${error.message || String(error)}`;
      return {
        outputs: {},
        textOutput: errorMessage,
      };
    }
  }

  /**
   * Execute library node
   */
  private async executeLibraryNode(node: GraphNode, inputs: Record<string, any>): Promise<Record<string, any>> {
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
  private async executeSubgraph(node: GraphNode, inputs: Record<string, any>): Promise<Record<string, any>> {
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
      n => n.config.type === NodeType.EXTERNAL_INPUT
    );

    for (const inputNode of externalInputNodes) {
      // Set inputs on external input nodes
      // This would be handled by the graph engine
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
   * Execute external output node
   */
  private async executeExternalOutput(node: GraphNode, inputs: Record<string, any>): Promise<Record<string, any>> {
    // External output nodes pass through their inputs as outputs
    return inputs;
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
}
