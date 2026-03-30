import type { GraphNode, RuntimeId } from '../types';
import {
  createAnnotationNode as createDomainAnnotationNode,
  createInlineCodeNode as createDomainInlineCodeNode,
  createNumericInputNode as createDomainNumericInputNode,
} from '../types';

export interface CreateNodeOptions {
  name?: string;
  position: { x: number; y: number };
  cardWidth?: number;
  cardHeight?: number;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  autoRecompute?: boolean;
  propagateWhileDragging?: boolean;
  dragDebounceSeconds?: number;
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

export function createInlineCodeNode(options: CreateNodeOptions): GraphNode {
  return createDomainInlineCodeNode(options);
}

export function createNumericInputNode(options: CreateNodeOptions): GraphNode {
  return createDomainNumericInputNode(options);
}

export function createAnnotationNode(options: CreateNodeOptions): GraphNode {
  return createDomainAnnotationNode({
    nodeId: undefined,
    name: options.name,
    position: options.position,
    cardWidth: options.cardWidth,
    cardHeight: options.cardHeight,
    text: options.annotationText,
    backgroundColor: options.annotationBackgroundColor,
    borderColor: options.annotationBorderColor,
    fontColor: options.annotationFontColor,
    fontSize: options.annotationFontSize,
  });
}
