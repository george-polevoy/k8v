import type { Container, Graphics, Text } from 'pixi.js';
import type {
  ConnectionAnchor,
  DrawingPath,
  GraphDrawing,
  GraphNode,
  Position,
} from '../types';

export interface NodeVisual {
  node: GraphNode;
  container: Container;
  width: number;
  height: number;
  projectedGraphicsHeight: number;
  inputPortOffsets: Map<string, number>;
  outputPortOffsets: Map<string, number>;
}

export interface PanState {
  pointerX: number;
  pointerY: number;
  viewportX: number;
  viewportY: number;
}

export type ResizeHandleDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface NodeDragState {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  nodeX: number;
  nodeY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

export interface NodeResizeState {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  handle: ResizeHandleDirection;
  minWidth: number;
  minHeight: number;
  currentX: number;
  currentY: number;
  currentWidth: number;
  currentHeight: number;
}

export interface HoveredResizeHandle {
  nodeId: string;
  handle: ResizeHandleDirection;
}

export interface SelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionDragState {
  pointerX: number;
  pointerY: number;
  nodeStartPositions: Map<string, Position>;
  currentNodePositions: Map<string, Position>;
  moved: boolean;
  duplicateOnDrag: boolean;
}

export interface SelectionResizeNodeState {
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface SelectionResizeState {
  pointerX: number;
  pointerY: number;
  bounds: SelectionBounds;
  handle: ResizeHandleDirection;
  nodeStates: Map<string, SelectionResizeNodeState>;
  currentBounds: SelectionBounds;
  currentNodeStates: Map<string, SelectionResizeNodeState>;
}

export interface HoveredSelectionResizeHandle {
  handle: ResizeHandleDirection;
}

export interface SelectionMarqueeState {
  startWorldX: number;
  startWorldY: number;
  currentWorldX: number;
  currentWorldY: number;
  additive: boolean;
  moved: boolean;
}

export interface AnnotationOverlayEntry {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  backgroundColor: string;
  fontColor: string;
  fontSize: number;
}

export interface AnnotationOverlayTransform {
  x: number;
  y: number;
  scale: number;
}

export interface AnnotationConnectionTarget {
  type: 'annotation';
  nodeId: string;
  anchor: ConnectionAnchor;
  point: Position;
}

export interface InputPortConnectionTarget {
  type: 'input-port';
  portKey: string;
}

export type HoveredConnectionTarget = AnnotationConnectionTarget | InputPortConnectionTarget | null;

export interface ConnectionDragState {
  sourceNodeId: string;
  sourcePort: string;
  sourcePortKey: string | null;
  sourceAnchor?: ConnectionAnchor;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  hoveredTarget: HoveredConnectionTarget;
}

export interface ActiveDrawingPath {
  drawingId: string;
  path: DrawingPath;
}

export interface DrawingDragState {
  drawingId: string;
  pointerX: number;
  pointerY: number;
  drawingX: number;
  drawingY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

export interface DrawingVisual {
  drawing: GraphDrawing;
  container: Container;
  width: number;
  height: number;
}

export interface NumericSliderVisual {
  nodeId: string;
  nodeContainer: Container;
  track: Graphics;
  knob: Graphics;
  valueLabel: Text;
  trackX: number;
  trackY: number;
  trackWidth: number;
  min: number;
  max: number;
  step: number;
  value: number;
}

export interface NumericSliderDragState {
  nodeId: string;
  initialValue: number;
  currentValue: number;
}

export interface NodeCardDimensions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}
