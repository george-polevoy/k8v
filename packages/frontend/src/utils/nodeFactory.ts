import { v4 as uuidv4 } from 'uuid';
import { GraphNode, NodeType, RuntimeId } from '../types';
import {
  DEFAULT_ANNOTATION_BACKGROUND_COLOR,
  DEFAULT_ANNOTATION_BORDER_COLOR,
  DEFAULT_ANNOTATION_FONT_COLOR,
  DEFAULT_ANNOTATION_FONT_SIZE,
  DEFAULT_ANNOTATION_TEXT,
  normalizeAnnotationFontSize,
} from './annotation';

export interface CreateNodeOptions {
  name?: string;
  position: { x: number; y: number };
  code?: string;
  runtime?: RuntimeId | string;
  pythonEnv?: string;
  inputNames?: string[];
  outputNames?: string[];
  annotationText?: string;
  annotationBackgroundColor?: string;
  annotationBorderColor?: string;
  annotationFontColor?: string;
  annotationFontSize?: number;
}

/**
 * Factory function for creating inline code nodes.
 * Single source of truth for node defaults to ensure consistency.
 */
export function createInlineCodeNode(options: CreateNodeOptions): GraphNode {
  const inputNames = options.inputNames && options.inputNames.length > 0
    ? options.inputNames
    : ['input'];
  const outputNames = options.outputNames && options.outputNames.length > 0
    ? options.outputNames
    : ['output'];

  return {
    id: uuidv4(),
    type: NodeType.INLINE_CODE,
    position: options.position,
    metadata: {
      name: options.name || 'Inline Code',
      inputs: inputNames.map((name) => ({
        name,
        schema: { type: 'object' as const },
      })),
      outputs: outputNames.map((name) => ({
        name,
        schema: { type: 'object' as const },
      })),
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

/**
 * Factory function for creating annotation nodes.
 */
export function createAnnotationNode(options: CreateNodeOptions): GraphNode {
  return {
    id: uuidv4(),
    type: NodeType.ANNOTATION,
    position: options.position,
    metadata: {
      name: options.name || 'Annotation',
      inputs: [],
      outputs: [],
    },
    config: {
      type: NodeType.ANNOTATION,
      config: {
        text: options.annotationText ?? DEFAULT_ANNOTATION_TEXT,
        backgroundColor: options.annotationBackgroundColor ?? DEFAULT_ANNOTATION_BACKGROUND_COLOR,
        borderColor: options.annotationBorderColor ?? DEFAULT_ANNOTATION_BORDER_COLOR,
        fontColor: options.annotationFontColor ?? DEFAULT_ANNOTATION_FONT_COLOR,
        fontSize: normalizeAnnotationFontSize(
          options.annotationFontSize,
          DEFAULT_ANNOTATION_FONT_SIZE
        ),
        cardWidth: 320,
        cardHeight: 200,
      },
    },
    version: Date.now().toString(),
  };
}
