import { v4 as uuidv4 } from 'uuid';
import { GraphNode, NodeType, RuntimeId } from '../types';

export interface CreateNodeOptions {
  name?: string;
  position: { x: number; y: number };
  code?: string;
  runtime?: RuntimeId | string;
  pythonEnv?: string;
}

/**
 * Factory function for creating inline code nodes.
 * Single source of truth for node defaults to ensure consistency.
 */
export function createInlineCodeNode(options: CreateNodeOptions): GraphNode {
  return {
    id: uuidv4(),
    type: NodeType.INLINE_CODE,
    position: options.position,
    metadata: {
      name: options.name || 'Inline Code',
      inputs: [{ name: 'input', schema: { type: 'object' } }],
      outputs: [{ name: 'output', schema: { type: 'object' } }],
    },
    config: {
      type: NodeType.INLINE_CODE,
      code: options.code || 'outputs.output = inputs.input;',
      runtime: options.runtime || 'javascript_vm',
      ...(options.pythonEnv ? { pythonEnv: options.pythonEnv } : {}),
    },
    version: Date.now().toString(),
  };
}

/**
 * Factory function for creating library nodes.
 */
export function createLibraryNode(options: CreateNodeOptions & { libraryId: string }): GraphNode {
  return {
    id: uuidv4(),
    type: NodeType.LIBRARY,
    position: options.position,
    metadata: {
      name: options.name || 'Library Node',
      inputs: [],
      outputs: [],
    },
    config: {
      type: NodeType.LIBRARY,
      libraryId: options.libraryId,
    },
    version: Date.now().toString(),
  };
}

/**
 * Factory function for creating external input nodes.
 */
export function createExternalInputNode(options: CreateNodeOptions): GraphNode {
  return {
    id: uuidv4(),
    type: NodeType.EXTERNAL_INPUT,
    position: options.position,
    metadata: {
      name: options.name || 'External Input',
      inputs: [],
      outputs: [{ name: 'output', schema: { type: 'object' } }],
    },
    config: {
      type: NodeType.EXTERNAL_INPUT,
    },
    version: Date.now().toString(),
  };
}

/**
 * Factory function for creating numeric input nodes.
 */
export function createNumericInputNode(options: CreateNodeOptions): GraphNode {
  return {
    id: uuidv4(),
    type: NodeType.NUMERIC_INPUT,
    position: options.position,
    metadata: {
      name: options.name || 'Numeric Input',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: NodeType.NUMERIC_INPUT,
      config: {
        value: 0,
        min: 0,
        max: 100,
        step: 1,
      },
    },
    version: Date.now().toString(),
  };
}

/**
 * Factory function for creating external output nodes.
 */
export function createExternalOutputNode(options: CreateNodeOptions): GraphNode {
  return {
    id: uuidv4(),
    type: NodeType.EXTERNAL_OUTPUT,
    position: options.position,
    metadata: {
      name: options.name || 'External Output',
      inputs: [{ name: 'input', schema: { type: 'object' } }],
      outputs: [],
    },
    config: {
      type: NodeType.EXTERNAL_OUTPUT,
    },
    version: Date.now().toString(),
  };
}
