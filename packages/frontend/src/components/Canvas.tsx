import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Application,
  Circle,
  Container,
  FederatedPointerEvent,
  Graphics,
  Matrix,
  Point,
  Rectangle,
  settings,
  Sprite,
  Text,
  Texture,
  WRAP_MODES,
} from 'pixi.js';
import { useGraphStore } from '../store/graphStore';
import type {
  NodeExecutionState,
  PencilColor,
  NodeGraphicsComputationDebug,
} from '../store/graphStore';
import {
  CanvasBackgroundSettings,
  DrawingPath,
  GraphDrawing,
  GraphNode,
  GraphicsArtifact,
  NodeType,
  Position,
} from '../types';
import { hasErroredNodeExecutionState, shouldKeepCanvasAnimationLoopRunning } from '../utils/canvasAnimation';
import { deriveGradientStops, normalizeCanvasBackground, resolveGraphCanvasBackground } from '../utils/canvasBackground';
import { colorStringToPixi, hexColorToNumber } from '../utils/color';
import {
  buildGraphicsImageUrl,
  estimateProjectedPixelBudget,
  isRenderableGraphicsArtifact,
  resolveStableGraphicsRequestMaxPixels,
} from '../utils/graphics';
import { truncateTextToWidth } from '../utils/textLayout';
import {
  resolveModifierWheelScrollDelta,
  resolveWheelZoomSensitivityMultiplier,
  shouldWheelPanCanvas,
} from '../utils/wheelNavigation';
import {
  DEFAULT_GRAPH_PROJECTION_ID,
  withNodeCardSizeInProjection,
  withNodePositionInProjection,
} from '../utils/projections';
import { v4 as uuidv4 } from 'uuid';
import AnnotationMarkdown from './AnnotationMarkdown';
import { normalizeAnnotationConfig } from '../utils/annotation';

const NODE_WIDTH = 220;
const NODE_MIN_WIDTH = 180;
const MIN_NODE_HEIGHT = 68;
const HEADER_HEIGHT = 36;
const NODE_BODY_PADDING = 6;
const ANNOTATION_TEXT_INSET_X = 8;
const ANNOTATION_TEXT_INSET_Y = 8;
const ANNOTATION_TEXT_INSET_BOTTOM = 8;
const PORT_SPACING = 18;
const PORT_RADIUS = 4;
const NODE_GRAPHICS_FALLBACK_ASPECT_RATIO = 0.6;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_SENSITIVITY = 0.0014;
const VIEWPORT_MARGIN = 100;
const EDGE_HIT_WIDTH = 16;
const CONNECTION_WIRE_SCREEN_WIDTH = 1;
const CONNECTION_WIRE_ALPHA = 0.2;
const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 140;
const MINIMAP_PADDING = 8;
const NODE_DRAG_START_THRESHOLD = 2;
const LIGHTNING_DURATION_MS = 900;
const NODE_SHOCK_DURATION_MS = 1200;
const DRAW_SMOOTHING_STEP = 1;
const NUMERIC_INPUT_NODE_MIN_HEIGHT = 80;
const NUMERIC_SLIDER_LEFT_PADDING = 12;
const NUMERIC_SLIDER_RIGHT_PADDING = 34;
const NUMERIC_SLIDER_Y_OFFSET = 15;
const NUMERIC_SLIDER_TRACK_WIDTH = 4;
const NUMERIC_SLIDER_KNOB_RADIUS = 7;
const NODE_RESIZE_HANDLE_SIZE = 10;
const NODE_RESIZE_HANDLE_MARGIN = 4;
const ANNOTATION_NODE_MIN_WIDTH = 140;
const ANNOTATION_NODE_MIN_HEIGHT = 84;
const SMOKE_EMIT_INTERVAL_MS = 140;
const SMOKE_MIN_DURATION_MS = 720;
const SMOKE_MAX_DURATION_MS = 1320;
const SMOKE_MAX_PARTICLES = 96;
const PROJECTION_TRANSITION_DURATION_MS = 260;
const NODE_CARD_BACKGROUND_ALPHA = 0.8;
const NODE_CARD_BACKGROUND_BOTTOM_ALPHA = 0.2;
const NODE_CARD_BORDER_WIDTH = 1.5;
const NODE_CARD_BORDER_MAX_ALPHA = 0.5;
const NODE_CARD_BORDER_PATTERN_WIDTH = 8;
const NODE_CARD_BORDER_PATTERN_HEIGHT = 256;
const NODE_CARD_CORNER_RADIUS = 20;
const NODE_CARD_BACKGROUND_PATTERN_WIDTH = 8;
const NODE_CARD_BACKGROUND_PATTERN_HEIGHT = 256;
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;
const MAX_TEXT_RESOLUTION = PIXEL_RATIO * 4;
const NODE_TITLE_CHAR_WIDTH_ESTIMATE = 8;
const NODE_TITLE_TEXT_STYLE = {
  fontFamily: 'Arial',
  fontSize: 14,
  fontWeight: 'bold' as const,
  fill: 0x0f172a,
};
const FALLBACK_NODE_EXECUTION_STATE: NodeExecutionState = {
  isPending: false,
  isComputing: false,
  hasError: false,
  isStale: false,
  errorMessage: null,
  lastRunAt: null,
};

interface NodeVisual {
  node: GraphNode;
  container: Container;
  width: number;
  height: number;
  projectedGraphicsHeight: number;
  inputPortOffsets: Map<string, number>;
  outputPortOffsets: Map<string, number>;
}

interface GraphicsTextureCacheEntry {
  texture: Texture;
  refCount: number;
}

interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PanState {
  pointerX: number;
  pointerY: number;
  viewportX: number;
  viewportY: number;
}

interface NodeDragState {
  nodeId: string;
  pointerX: number;
  pointerY: number;
  nodeX: number;
  nodeY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface NodeResizeState {
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

type ResizeHandleDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface HoveredResizeHandle {
  nodeId: string;
  handle: ResizeHandleDirection;
}

interface AnnotationOverlayEntry {
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

interface AnnotationOverlayTransform {
  x: number;
  y: number;
  scale: number;
}

interface ConnectionDragState {
  sourceNodeId: string;
  sourcePort: string;
  sourcePortKey: string;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  hoveredInputKey: string | null;
}

interface MinimapTransform {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ConnectionGeometry {
  id: string;
  startX: number;
  startY: number;
  c1X: number;
  c1Y: number;
  c2X: number;
  c2Y: number;
  endX: number;
  endY: number;
}

interface LightningPulse {
  connectionId: string;
  startAt: number;
  durationMs: number;
}

interface NodeShock {
  nodeId: string;
  startAt: number;
  durationMs: number;
}

interface ActiveDrawingPath {
  drawingId: string;
  path: DrawingPath;
}

interface DrawingDragState {
  drawingId: string;
  pointerX: number;
  pointerY: number;
  drawingX: number;
  drawingY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface DrawingVisual {
  drawing: GraphDrawing;
  container: Container;
  width: number;
  height: number;
}

interface SmokePuff {
  nodeId: string;
  startAt: number;
  durationMs: number;
  originX: number;
  originY: number;
  driftX: number;
  driftY: number;
  startRadius: number;
  startAlpha: number;
  wobblePhase: number;
}

interface NumericInputConfig {
  value: number;
  min: number;
  max: number;
  step: number;
}

interface NumericSliderVisual {
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

interface NumericSliderDragState {
  nodeId: string;
  initialValue: number;
  currentValue: number;
}

interface NodeCardDimensions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

interface ProjectionNodeVisualState {
  position: Position;
  width: number;
  height: number;
}

interface ProjectionTransitionState {
  graphId: string;
  fromProjectionId: string;
  toProjectionId: string;
  fromBackground: CanvasBackgroundSettings;
  toBackground: CanvasBackgroundSettings;
  fromNodes: Map<string, ProjectionNodeVisualState>;
  toNodes: Map<string, ProjectionNodeVisualState>;
  startAt: number;
  durationMs: number;
}

let nodeCardBorderTexture: Texture | null = null;
let nodeCardBackgroundFadeTexture: Texture | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function parseHexColor(hexColor: string): { r: number; g: number; b: number } {
  const normalized = normalizeCanvasBackground({
    mode: 'gradient',
    baseColor: hexColor,
  }).baseColor;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function interpolateCanvasBackground(
  from: CanvasBackgroundSettings,
  to: CanvasBackgroundSettings,
  amount: number
): CanvasBackgroundSettings {
  const t = clamp(amount, 0, 1);
  const fromRgb = parseHexColor(from.baseColor);
  const toRgb = parseHexColor(to.baseColor);
  const baseColor = rgbToHex({
    r: fromRgb.r + (toRgb.r - fromRgb.r) * t,
    g: fromRgb.g + (toRgb.g - fromRgb.g) * t,
    b: fromRgb.b + (toRgb.b - fromRgb.b) * t,
  });

  return {
    mode: t < 0.5 ? from.mode : to.mode,
    baseColor,
  };
}

function snapToPixel(value: number): number {
  return Math.round(value);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function countStepDecimals(step: number): number {
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

function snapNumericInputValue(value: number, min: number, max: number, step: number): number {
  if (max <= min) {
    return min;
  }

  const clamped = clamp(value, min, max);
  const steps = Math.round((clamped - min) / step);
  const snapped = min + (steps * step);
  const decimals = countStepDecimals(step);
  const rounded = Number(snapped.toFixed(decimals));
  return clamp(rounded, min, max);
}

function normalizeNumericInputConfig(config?: Record<string, unknown>): NumericInputConfig {
  const min = toFiniteNumber(config?.min, 0);
  const maxCandidate = toFiniteNumber(config?.max, 100);
  const max = maxCandidate >= min ? maxCandidate : min;
  const stepCandidate = toFiniteNumber(config?.step, 1);
  const step = stepCandidate > 0 ? stepCandidate : 1;
  const valueCandidate = toFiniteNumber(config?.value, min);
  const value = snapNumericInputValue(valueCandidate, min, max, step);
  return { value, min, max, step };
}

function formatNumericInputValue(value: number, step: number): string {
  const decimals = Math.min(countStepDecimals(step), 8);
  if (decimals <= 0) {
    return String(Math.round(value));
  }
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

function resolveNumericSliderValue(
  localX: number,
  slider: NumericSliderVisual
): number {
  if (slider.trackWidth <= 0 || slider.max <= slider.min) {
    return slider.min;
  }

  const ratio = clamp((localX - slider.trackX) / slider.trackWidth, 0, 1);
  const rawValue = slider.min + (ratio * (slider.max - slider.min));
  return snapNumericInputValue(rawValue, slider.min, slider.max, slider.step);
}

function drawNumericSliderVisual(slider: NumericSliderVisual): void {
  const ratio = slider.max > slider.min
    ? clamp((slider.value - slider.min) / (slider.max - slider.min), 0, 1)
    : 0;
  const knobX = slider.trackX + (ratio * slider.trackWidth);

  slider.track.clear();
  slider.track.lineStyle(NUMERIC_SLIDER_TRACK_WIDTH, 0xcbd5e1, 1, 0.5, false);
  slider.track.moveTo(slider.trackX, slider.trackY);
  slider.track.lineTo(slider.trackX + slider.trackWidth, slider.trackY);
  slider.track.lineStyle(NUMERIC_SLIDER_TRACK_WIDTH, 0x2563eb, 1, 0.5, false);
  slider.track.moveTo(slider.trackX, slider.trackY);
  slider.track.lineTo(knobX, slider.trackY);

  slider.knob.clear();
  slider.knob.lineStyle(1, 0x1d4ed8, 1);
  slider.knob.beginFill(0xffffff, 1);
  slider.knob.drawCircle(knobX, slider.trackY, NUMERIC_SLIDER_KNOB_RADIUS);
  slider.knob.endFill();

  slider.valueLabel.text = formatNumericInputValue(slider.value, slider.step);
}

function makePortKey(nodeId: string, portName: string): string {
  return `${nodeId}\u0000${portName}`;
}

function parsePortKey(key: string): { nodeId: string; portName: string } {
  const separatorIndex = key.indexOf('\u0000');
  if (separatorIndex === -1) {
    return { nodeId: key, portName: '' };
  }

  return {
    nodeId: key.slice(0, separatorIndex),
    portName: key.slice(separatorIndex + 1),
  };
}

function drawInputPortMarker(marker: Graphics, highlighted: boolean): void {
  marker.clear();
  marker.beginFill(highlighted ? 0x2563eb : 0x1d4ed8);
  marker.drawCircle(0, 0, highlighted ? PORT_RADIUS + 2 : PORT_RADIUS);
  marker.endFill();
}

function drawOutputPortMarker(marker: Graphics, highlighted: boolean): void {
  marker.clear();
  marker.beginFill(highlighted ? 0x22c55e : 0x16a34a);
  marker.drawCircle(0, 0, highlighted ? PORT_RADIUS + 2 : PORT_RADIUS);
  marker.endFill();
}

function resolvePencilColor(color: PencilColor): number {
  return hexColorToNumber(color, '#ffffff');
}

function getNextDrawingName(drawings: GraphDrawing[]): string {
  const existing = new Set(drawings.map((drawing) => drawing.name));
  let index = 1;
  let candidate = `Drawing ${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `Drawing ${index}`;
  }
  return candidate;
}

function isRenderablePythonGraphicsOutput(
  node: GraphNode,
  graphicsOutput: GraphicsArtifact | null | undefined
): graphicsOutput is GraphicsArtifact {
  return node.config.runtime === 'python_process' &&
    isRenderableGraphicsArtifact(graphicsOutput);
}

function getNodeMinWidth(node: GraphNode): number {
  if (node.type === NodeType.ANNOTATION) {
    return ANNOTATION_NODE_MIN_WIDTH;
  }
  return NODE_MIN_WIDTH;
}

function getNodeMinHeight(node: GraphNode): number {
  if (node.type === NodeType.ANNOTATION) {
    return ANNOTATION_NODE_MIN_HEIGHT;
  }
  const maxPorts = Math.max(node.metadata.inputs.length, node.metadata.outputs.length, 1);
  const baseHeight = Math.max(MIN_NODE_HEIGHT, HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING));
  if (node.type === NodeType.NUMERIC_INPUT) {
    return Math.max(baseHeight, NUMERIC_INPUT_NODE_MIN_HEIGHT);
  }
  return baseHeight;
}

function resolveNodeCardDimensions(
  node: GraphNode,
  draftSize?: { width: number; height: number }
): NodeCardDimensions {
  const minWidth = getNodeMinWidth(node);
  const minHeight = getNodeMinHeight(node);
  const nodeConfig = (node.config.config ?? {}) as Record<string, unknown>;
  const widthCandidate = draftSize
    ? draftSize.width
    : toFiniteNumber(nodeConfig.cardWidth, NODE_WIDTH);
  const heightCandidate = draftSize
    ? draftSize.height
    : toFiniteNumber(nodeConfig.cardHeight, minHeight);

  const width = Math.max(minWidth, snapToPixel(widthCandidate));
  const height = Math.max(minHeight, snapToPixel(heightCandidate));
  return { width, height, minWidth, minHeight };
}

function resolveResizeCursor(handle: ResizeHandleDirection): string {
  if (handle === 'n' || handle === 's') {
    return 'ns-resize';
  }
  if (handle === 'e' || handle === 'w') {
    return 'ew-resize';
  }
  if (handle === 'ne' || handle === 'sw') {
    return 'nesw-resize';
  }
  return 'nwse-resize';
}

function areAnnotationOverlaysEqual(
  left: AnnotationOverlayEntry[],
  right: AnnotationOverlayEntry[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem.nodeId !== rightItem.nodeId ||
      leftItem.x !== rightItem.x ||
      leftItem.y !== rightItem.y ||
      leftItem.width !== rightItem.width ||
      leftItem.height !== rightItem.height ||
      leftItem.text !== rightItem.text ||
      leftItem.backgroundColor !== rightItem.backgroundColor ||
      leftItem.fontColor !== rightItem.fontColor ||
      leftItem.fontSize !== rightItem.fontSize
    ) {
      return false;
    }
  }

  return true;
}

function resolveNodeRenderTargetPosition(
  node: GraphNode,
  dragState: NodeDragState | null,
  draftPosition?: Position
): Position {
  if (!dragState || dragState.nodeId !== node.id) {
    if (draftPosition) {
      return { ...draftPosition };
    }
    return { ...node.position };
  }

  return {
    x: dragState.currentX,
    y: dragState.currentY,
  };
}

function getTextureDimensions(texture: Texture): { width: number; height: number; valid: boolean } {
  const width = texture.orig.width || texture.width || 0;
  const height = texture.orig.height || texture.height || 0;
  const valid = texture.baseTexture.valid && width > 0 && height > 0;
  return { width, height, valid };
}

function getViewportWorldBounds(app: Application, viewport: Container): WorldBounds {
  const scaleX = Math.max(Math.abs(viewport.scale.x || 1), 0.0001);
  const scaleY = Math.max(Math.abs(viewport.scale.y || 1), 0.0001);
  const minX = -viewport.position.x / scaleX;
  const minY = -viewport.position.y / scaleY;
  return {
    minX,
    minY,
    maxX: minX + app.screen.width / scaleX,
    maxY: minY + app.screen.height / scaleY,
  };
}

function worldBoundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY);
}

function resolveGraphicsAspectRatio(graphics: GraphicsArtifact): number {
  const baseLevel = graphics.levels[0];
  if (!baseLevel || baseLevel.width <= 0 || baseLevel.height <= 0) {
    return NODE_GRAPHICS_FALLBACK_ASPECT_RATIO;
  }

  return Math.max(baseLevel.height / baseLevel.width, 0.01);
}

function getCanvasBackgroundSignature(
  background: CanvasBackgroundSettings,
  width: number,
  height: number
): string {
  return `${background.mode}:${background.baseColor}:${Math.round(width)}x${Math.round(height)}`;
}

function createCanvasBackgroundTexture(
  width: number,
  height: number,
  background: CanvasBackgroundSettings
): Texture {
  const safeWidth = Math.max(2, Math.round(width * PIXEL_RATIO));
  const safeHeight = Math.max(2, Math.round(height * PIXEL_RATIO));
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Texture.WHITE;
  }

  if (background.mode === 'solid') {
    ctx.fillStyle = background.baseColor;
    ctx.fillRect(0, 0, safeWidth, safeHeight);
    return Texture.from(canvas);
  }

  const [highlight, base, shadow, deepShadow] = deriveGradientStops(background.baseColor);
  const gradient = ctx.createRadialGradient(
    safeWidth * 0.12,
    safeHeight * 0.08,
    safeWidth * 0.06,
    safeWidth * 0.52,
    safeHeight * 0.56,
    Math.max(safeWidth, safeHeight) * 0.9
  );
  gradient.addColorStop(0, highlight);
  gradient.addColorStop(0.35, base);
  gradient.addColorStop(0.7, shadow);
  gradient.addColorStop(1, deepShadow);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, safeWidth, safeHeight);
  return Texture.from(canvas);
}

function getNodeCardBorderTexture(): Texture {
  if (nodeCardBorderTexture) {
    return nodeCardBorderTexture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = NODE_CARD_BORDER_PATTERN_WIDTH;
  canvas.height = NODE_CARD_BORDER_PATTERN_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Texture.WHITE;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.5, '#808080');
  gradient.addColorStop(1, '#ffffff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = Texture.from(canvas);
  texture.baseTexture.wrapMode = WRAP_MODES.CLAMP;
  nodeCardBorderTexture = texture;
  return texture;
}

function getNodeCardBackgroundFadeTexture(): Texture {
  if (nodeCardBackgroundFadeTexture) {
    return nodeCardBackgroundFadeTexture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = NODE_CARD_BACKGROUND_PATTERN_WIDTH;
  canvas.height = NODE_CARD_BACKGROUND_PATTERN_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Texture.WHITE;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = Texture.from(canvas);
  texture.baseTexture.wrapMode = WRAP_MODES.CLAMP;
  nodeCardBackgroundFadeTexture = texture;
  return texture;
}

function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) {
    return 1;
  }
  return Math.max(0, Math.min(1, alpha));
}

function blendPixiColors(baseColor: number, targetColor: number, amount: number): number {
  const clampedAmount = Math.max(0, Math.min(1, amount));
  const baseR = (baseColor >> 16) & 0xff;
  const baseG = (baseColor >> 8) & 0xff;
  const baseB = baseColor & 0xff;
  const targetR = (targetColor >> 16) & 0xff;
  const targetG = (targetColor >> 8) & 0xff;
  const targetB = targetColor & 0xff;
  const blendedR = Math.round(baseR + ((targetR - baseR) * clampedAmount));
  const blendedG = Math.round(baseG + ((targetG - baseG) * clampedAmount));
  const blendedB = Math.round(baseB + ((targetB - baseB) * clampedAmount));

  return (blendedR << 16) | (blendedG << 8) | blendedB;
}

function drawNodeCardPath(
  graphics: Graphics,
  width: number,
  height: number,
  squareBottomCorners: boolean,
  inset = 0,
  radius = NODE_CARD_CORNER_RADIUS
): void {
  const x = inset;
  const y = inset;
  const shapeWidth = Math.max(1, width - (inset * 2));
  const shapeHeight = Math.max(1, height - (inset * 2));
  const resolvedRadius = Math.min(radius, Math.floor(shapeWidth * 0.5), Math.floor(shapeHeight * 0.5));

  if (!squareBottomCorners) {
    graphics.drawRoundedRect(x, y, shapeWidth, shapeHeight, resolvedRadius);
    return;
  }

  graphics.moveTo(x + resolvedRadius, y);
  graphics.lineTo(x + shapeWidth - resolvedRadius, y);
  graphics.quadraticCurveTo(x + shapeWidth, y, x + shapeWidth, y + resolvedRadius);
  graphics.lineTo(x + shapeWidth, y + shapeHeight);
  graphics.lineTo(x, y + shapeHeight);
  graphics.lineTo(x, y + resolvedRadius);
  graphics.quadraticCurveTo(x, y, x + resolvedRadius, y);
  graphics.lineTo(x + resolvedRadius, y);
}

function drawNodeCardFrame(
  graphics: Graphics,
  width: number,
  height: number,
  strokeColor: number,
  fillColor: number,
  squareBottomCorners: boolean,
  strokeAlpha = 1,
  fillAlpha = 1,
  useGlobalBackgroundOpacityCap = true
): void {
  const safeStrokeAlpha = clampAlpha(strokeAlpha);
  const safeFillAlpha = useGlobalBackgroundOpacityCap
    ? clampAlpha(Math.min(fillAlpha, NODE_CARD_BACKGROUND_ALPHA))
    : clampAlpha(fillAlpha);
  const strokeInset = NODE_CARD_BORDER_WIDTH * 0.5;
  const fillBaseAlpha = clampAlpha(Math.min(safeFillAlpha, NODE_CARD_BACKGROUND_BOTTOM_ALPHA));
  const fillOverlayAlpha = clampAlpha(safeFillAlpha - fillBaseAlpha);
  const fillTextureMatrix = new Matrix(
    1,
    0,
    0,
    Math.max(1, height) / NODE_CARD_BACKGROUND_PATTERN_HEIGHT,
    0,
    0
  );
  const cardBackgroundFadeTexture = getNodeCardBackgroundFadeTexture();
  const gradientSpanHeight = Math.max(1, height - (strokeInset * 2));
  const borderTextureMatrix = new Matrix(
    1,
    0,
    0,
    gradientSpanHeight / NODE_CARD_BORDER_PATTERN_HEIGHT,
    0,
    strokeInset
  );
  const cardBorderTexture = getNodeCardBorderTexture();
  const strokeTintColor = blendPixiColors(strokeColor, 0xffffff, 0.92);
  const resolvedStrokeAlpha = clampAlpha(Math.min(safeStrokeAlpha, NODE_CARD_BORDER_MAX_ALPHA));

  graphics.beginFill(fillColor, fillBaseAlpha);
  drawNodeCardPath(graphics, width, height, squareBottomCorners, 0, NODE_CARD_CORNER_RADIUS);
  graphics.endFill();
  if (fillOverlayAlpha > 0) {
    graphics.beginTextureFill({
      texture: cardBackgroundFadeTexture,
      color: fillColor,
      alpha: fillOverlayAlpha,
      matrix: fillTextureMatrix,
    });
    drawNodeCardPath(graphics, width, height, squareBottomCorners, 0, NODE_CARD_CORNER_RADIUS);
    graphics.endFill();
  }

  if (safeStrokeAlpha <= 0) {
    return;
  }

  if (width <= strokeInset * 2 || height <= strokeInset * 2) {
    return;
  }

  graphics.lineTextureStyle({
    width: NODE_CARD_BORDER_WIDTH,
    texture: cardBorderTexture,
    color: strokeTintColor,
    alpha: resolvedStrokeAlpha,
    alignment: 0.5,
    matrix: borderTextureMatrix,
  });
  drawNodeCardPath(graphics, width, height, squareBottomCorners, strokeInset, NODE_CARD_CORNER_RADIUS);
}

function drawBezierConnection(
  graphics: Graphics,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): void {
  const controlOffset = Math.max(Math.abs(endX - startX) * 0.4, 60);
  graphics.moveTo(startX, startY);
  graphics.bezierCurveTo(
    startX + controlOffset,
    startY,
    endX - controlOffset,
    endY,
    endX,
    endY
  );
}

function getBezierGeometry(
  id: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): ConnectionGeometry {
  const controlOffset = Math.max(Math.abs(endX - startX) * 0.4, 60);
  return {
    id,
    startX,
    startY,
    c1X: startX + controlOffset,
    c1Y: startY,
    c2X: endX - controlOffset,
    c2Y: endY,
    endX,
    endY,
  };
}

function pointOnBezier(geometry: ConnectionGeometry, t: number): { x: number; y: number } {
  const oneMinus = 1 - t;
  const oneMinus2 = oneMinus * oneMinus;
  const oneMinus3 = oneMinus2 * oneMinus;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x:
      oneMinus3 * geometry.startX +
      3 * oneMinus2 * t * geometry.c1X +
      3 * oneMinus * t2 * geometry.c2X +
      t3 * geometry.endX,
    y:
      oneMinus3 * geometry.startY +
      3 * oneMinus2 * t * geometry.c1Y +
      3 * oneMinus * t2 * geometry.c2Y +
      t3 * geometry.endY,
  };
}

function tangentOnBezier(geometry: ConnectionGeometry, t: number): { x: number; y: number } {
  const oneMinus = 1 - t;
  const t2 = t * t;
  const oneMinus2 = oneMinus * oneMinus;

  return {
    x:
      3 * oneMinus2 * (geometry.c1X - geometry.startX) +
      6 * oneMinus * t * (geometry.c2X - geometry.c1X) +
      3 * t2 * (geometry.endX - geometry.c2X),
    y:
      3 * oneMinus2 * (geometry.c1Y - geometry.startY) +
      6 * oneMinus * t * (geometry.c2Y - geometry.c1Y) +
      3 * t2 * (geometry.endY - geometry.c2Y),
  };
}

function normalizeVector(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function distanceSquaredToSegment(
  pointX: number,
  pointY: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) {
    const ox = pointX - x1;
    const oy = pointY - y1;
    return (ox * ox) + (oy * oy);
  }

  const t = clamp(((pointX - x1) * dx + (pointY - y1) * dy) / lengthSquared, 0, 1);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ox = pointX - projX;
  const oy = pointY - projY;
  return (ox * ox) + (oy * oy);
}

function distanceSquaredToBezier(
  pointX: number,
  pointY: number,
  geometry: ConnectionGeometry
): number {
  const samples = 28;
  let best = Number.POSITIVE_INFINITY;
  let previous = pointOnBezier(geometry, 0);

  for (let i = 1; i <= samples; i += 1) {
    const current = pointOnBezier(geometry, i / samples);
    const distanceSquared = distanceSquaredToSegment(
      pointX,
      pointY,
      previous.x,
      previous.y,
      current.x,
      current.y
    );
    if (distanceSquared < best) {
      best = distanceSquared;
    }
    previous = current;
  }

  return best;
}

function createsCycle(
  nodes: GraphNode[],
  sourceNodeId: string,
  targetNodeId: string,
  connections: Array<{ sourceNodeId: string; targetNodeId: string }>
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true;
  }

  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  for (const connection of connections) {
    const next = adjacency.get(connection.sourceNodeId);
    if (next) {
      next.push(connection.targetNodeId);
    }
  }

  const stack = [targetNodeId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    if (current === sourceNodeId) {
      return true;
    }

    visited.add(current);
    const nextNodes = adjacency.get(current) || [];
    for (const next of nextNodes) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

function areNodeGraphicsDebugValuesEqual(
  left: NodeGraphicsComputationDebug | null,
  right: NodeGraphicsComputationDebug | null
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  if (
    left.nodeId !== right.nodeId ||
    left.nodeType !== right.nodeType ||
    left.hasGraphicsOutput !== right.hasGraphicsOutput ||
    left.isRenderableGraphics !== right.isRenderableGraphics ||
    left.graphicsId !== right.graphicsId ||
    left.mimeType !== right.mimeType ||
    left.levelCount !== right.levelCount ||
    left.viewportScale !== right.viewportScale ||
    left.projectionWidth !== right.projectionWidth ||
    left.projectedWidthOnScreen !== right.projectedWidthOnScreen ||
    left.devicePixelRatio !== right.devicePixelRatio ||
    left.estimatedMaxPixels !== right.estimatedMaxPixels ||
    left.stableMaxPixels !== right.stableMaxPixels ||
    left.selectedLevel !== right.selectedLevel ||
    left.selectedLevelPixels !== right.selectedLevelPixels ||
    left.shouldLoadProjectedGraphicsByViewport !== right.shouldLoadProjectedGraphicsByViewport ||
    left.canReloadProjectedGraphics !== right.canReloadProjectedGraphics ||
    left.shouldLoadProjectedGraphics !== right.shouldLoadProjectedGraphics ||
    left.requestUrl !== right.requestUrl
  ) {
    return false;
  }

  if (left.levelPixels.length !== right.levelPixels.length) {
    return false;
  }

  for (let index = 0; index < left.levelPixels.length; index += 1) {
    if (left.levelPixels[index] !== right.levelPixels[index]) {
      return false;
    }
  }

  return true;
}

function Canvas() {
  const graph = useGraphStore((state) => state.graph);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const selectedDrawingId = useGraphStore((state) => state.selectedDrawingId);
  const nodeExecutionStates = useGraphStore((state) => state.nodeExecutionStates);
  const nodeGraphicsOutputs = useGraphStore((state) => state.nodeGraphicsOutputs);
  const selectNode = useGraphStore((state) => state.selectNode);
  const updateNode = useGraphStore((state) => state.updateNode);
  const updateGraph = useGraphStore((state) => state.updateGraph);
  const selectDrawing = useGraphStore((state) => state.selectDrawing);
  const updateNodePosition = useGraphStore((state) => state.updateNodePosition);
  const updateDrawingPosition = useGraphStore((state) => state.updateDrawingPosition);
  const addDrawing = useGraphStore((state) => state.addDrawing);
  const addDrawingPath = useGraphStore((state) => state.addDrawingPath);
  const deleteDrawing = useGraphStore((state) => state.deleteDrawing);
  const drawingCreateRequestId = useGraphStore((state) => state.drawingCreateRequestId);
  const addConnection = useGraphStore((state) => state.addConnection);
  const deleteConnection = useGraphStore((state) => state.deleteConnection);
  const deleteNode = useGraphStore((state) => state.deleteNode);
  const createGraph = useGraphStore((state) => state.createGraph);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);
  const drawingEnabled = useGraphStore((state) => state.drawingEnabled);
  const drawingColor = useGraphStore((state) => state.drawingColor);
  const drawingThickness = useGraphStore((state) => state.drawingThickness);
  const setSelectedNodeGraphicsDebug = useGraphStore((state) => state.setSelectedNodeGraphicsDebug);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapTransformRef = useRef<MinimapTransform | null>(null);
  const appRef = useRef<Application | null>(null);
  const backgroundSpriteRef = useRef<Sprite | null>(null);
  const appliedCanvasBackgroundSignatureRef = useRef('');
  const lastResolvedCanvasBackgroundRef = useRef<CanvasBackgroundSettings>(resolveGraphCanvasBackground(graph));
  const viewportRef = useRef<Container | null>(null);
  const nodeLayerRef = useRef<Container | null>(null);
  const drawingHandleLayerRef = useRef<Container | null>(null);
  const edgeLayerRef = useRef<Graphics | null>(null);
  const drawLayerRef = useRef<Graphics | null>(null);
  const effectsLayerRef = useRef<Graphics | null>(null);
  const connectionGeometriesRef = useRef<Map<string, ConnectionGeometry>>(new Map());
  const lightningPulsesRef = useRef<LightningPulse[]>([]);
  const nodeShocksRef = useRef<NodeShock[]>([]);
  const drawingVisualsRef = useRef<Map<string, DrawingVisual>>(new Map());
  const drawingPositionsRef = useRef<Map<string, Position>>(new Map());
  const drawingDragStateRef = useRef<DrawingDragState | null>(null);
  const numericSliderVisualsRef = useRef<Map<string, NumericSliderVisual>>(new Map());
  const numericSliderDragStateRef = useRef<NumericSliderDragState | null>(null);
  const hoveredNumericSliderNodeIdRef = useRef<string | null>(null);
  const activeDrawingPathRef = useRef<ActiveDrawingPath | null>(null);
  const smokePuffsRef = useRef<SmokePuff[]>([]);
  const lastSmokeEmitAtRef = useRef<Map<string, number>>(new Map());
  const nodeVisualsRef = useRef<Map<string, NodeVisual>>(new Map());
  const nodePositionsRef = useRef<Map<string, Position>>(new Map());
  const textNodesRef = useRef<Set<Text>>(new Set());
  const inputPortMarkersRef = useRef<Map<string, Graphics>>(new Map());
  const outputPortMarkersRef = useRef<Map<string, Graphics>>(new Map());
  const inputPortPositionsRef = useRef<Map<string, Position>>(new Map());
  const outputPortPositionsRef = useRef<Map<string, Position>>(new Map());
  const hoveredInputPortKeyRef = useRef<string | null>(null);
  const hoveredOutputPortKeyRef = useRef<string | null>(null);
  const connectionDragStateRef = useRef<ConnectionDragState | null>(null);
  const selectedConnectionIdRef = useRef<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  const selectedDrawingIdRef = useRef<string | null>(selectedDrawingId);
  const nodeExecutionStatesRef = useRef(nodeExecutionStates);
  const drawingEnabledRef = useRef(drawingEnabled);
  const drawingColorRef = useRef(drawingColor);
  const drawingThicknessRef = useRef(drawingThickness);
  const previousNodeExecutionStatesRef = useRef<Record<string, NodeExecutionState>>({});
  const nodeGraphicsOutputsRef = useRef(nodeGraphicsOutputs);
  const nodeGraphicsTextureBindingsRef = useRef<Map<string, string>>(new Map());
  const nodePendingGraphicsTextureBindingsRef = useRef<Map<string, string>>(new Map());
  const graphicsTextureCacheRef = useRef<Map<string, GraphicsTextureCacheEntry>>(new Map());
  const pendingGraphicsTextureLoadsRef = useRef<Map<string, Texture>>(new Map());
  const graphRef = useRef(graph);
  const selectedNodeGraphicsDebugRef = useRef<NodeGraphicsComputationDebug | null>(null);
  const projectionTransitionRef = useRef<ProjectionTransitionState | null>(null);
  const renderGraphRef = useRef<() => void>(() => {});
  const viewportRefreshRafRef = useRef<number | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const nodeDragStateRef = useRef<NodeDragState | null>(null);
  const nodeResizeStateRef = useRef<NodeResizeState | null>(null);
  const hoveredNodeResizeHandleRef = useRef<HoveredResizeHandle | null>(null);
  const nodeCardDraftSizesRef = useRef<Map<string, { width: number; height: number }>>(new Map());
  const nodeCardDraftPositionsRef = useRef<Map<string, Position>>(new Map());
  const lastGraphIdRef = useRef<string | null>(null);
  const viewportInitializedRef = useRef(false);
  const handledDrawingCreateRequestRef = useRef(0);
  const annotationOverlaysRef = useRef<AnnotationOverlayEntry[]>([]);
  const annotationOverlayTransformRef = useRef<AnnotationOverlayTransform>({ x: 0, y: 0, scale: 1 });
  const [canvasReady, setCanvasReady] = useState(false);
  const [annotationOverlays, setAnnotationOverlays] = useState<AnnotationOverlayEntry[]>([]);
  const [annotationOverlayTransform, setAnnotationOverlayTransform] = useState<AnnotationOverlayTransform>({
    x: 0,
    y: 0,
    scale: 1,
  });
  selectedNodeIdRef.current = selectedNodeId;
  selectedDrawingIdRef.current = selectedDrawingId;
  nodeExecutionStatesRef.current = nodeExecutionStates;
  nodeGraphicsOutputsRef.current = nodeGraphicsOutputs;
  drawingEnabledRef.current = drawingEnabled;
  drawingColorRef.current = drawingColor;
  drawingThicknessRef.current = drawingThickness;

  const requestCanvasAnimationLoop = useCallback(() => {
    const app = appRef.current;
    if (!app || app.ticker.started) {
      return;
    }
    app.start();
  }, []);

  const requestViewportDrivenGraphRefresh = useCallback(() => {
    if (viewportRefreshRafRef.current !== null) {
      return;
    }

    viewportRefreshRafRef.current = window.requestAnimationFrame(() => {
      viewportRefreshRafRef.current = null;
      renderGraphRef.current();
    });
  }, []);

  const refreshCanvasBackgroundTexture = useCallback((backgroundOverride?: CanvasBackgroundSettings) => {
    const app = appRef.current;
    const backgroundSprite = backgroundSpriteRef.current;
    if (!app || !backgroundSprite) {
      return;
    }

    const resolvedBackground = normalizeCanvasBackground(
      backgroundOverride ?? resolveGraphCanvasBackground(graphRef.current)
    );
    const signature = getCanvasBackgroundSignature(
      resolvedBackground,
      app.screen.width,
      app.screen.height
    );
    if (signature === appliedCanvasBackgroundSignatureRef.current) {
      return;
    }

    const previousTexture = backgroundSprite.texture;
    backgroundSprite.texture = createCanvasBackgroundTexture(
      app.screen.width,
      app.screen.height,
      resolvedBackground
    );
    backgroundSprite.width = app.screen.width;
    backgroundSprite.height = app.screen.height;
    appliedCanvasBackgroundSignatureRef.current = signature;
    lastResolvedCanvasBackgroundRef.current = resolvedBackground;

    if (previousTexture !== Texture.WHITE && previousTexture !== backgroundSprite.texture) {
      previousTexture.destroy(true);
    }
  }, []);

  const applyCanvasCursor = useCallback(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }

    const canvas = app.view as HTMLCanvasElement;
    if (drawingEnabledRef.current) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (nodeResizeStateRef.current || hoveredNodeResizeHandleRef.current) {
      const resizeHandle =
        nodeResizeStateRef.current?.handle ??
        hoveredNodeResizeHandleRef.current?.handle ??
        'se';
      canvas.style.cursor = resolveResizeCursor(resizeHandle);
      return;
    }
    if (numericSliderDragStateRef.current || hoveredNumericSliderNodeIdRef.current) {
      canvas.style.cursor = 'ew-resize';
      return;
    }
    if (panStateRef.current) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    canvas.style.cursor = 'grab';
  }, []);

  const shouldKeepCanvasAnimationLoop = useCallback(() => {
    return shouldKeepCanvasAnimationLoopRunning({
      hasActiveInteraction: Boolean(
        connectionDragStateRef.current ||
        nodeDragStateRef.current ||
        nodeResizeStateRef.current ||
        numericSliderDragStateRef.current ||
        drawingDragStateRef.current ||
        panStateRef.current ||
        activeDrawingPathRef.current
      ),
      hasErroredNodes: hasErroredNodeExecutionState(nodeExecutionStatesRef.current),
      lightningPulseCount: lightningPulsesRef.current.length,
      nodeShockCount: nodeShocksRef.current.length,
      smokePuffCount: smokePuffsRef.current.length,
    });
  }, []);

  const pauseCanvasAnimationLoopIfIdle = useCallback(() => {
    const app = appRef.current;
    if (!app || !app.ticker.started) {
      return;
    }
    if (shouldKeepCanvasAnimationLoop()) {
      return;
    }
    app.stop();
  }, [shouldKeepCanvasAnimationLoop]);

  const drawMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;

    if (!canvas || !app || !viewport) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const cssWidth = MINIMAP_WIDTH;
    const cssHeight = MINIMAP_HEIGHT;
    const dpr = PIXEL_RATIO;
    const deviceWidth = Math.max(1, Math.round(cssWidth * dpr));
    const deviceHeight = Math.max(1, Math.round(cssHeight * dpr));

    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const viewportScale = viewport.scale.x || 1;
    const viewMinX = -viewport.position.x / viewportScale;
    const viewMinY = -viewport.position.y / viewportScale;
    const viewMaxX = viewMinX + app.screen.width / viewportScale;
    const viewMaxY = viewMinY + app.screen.height / viewportScale;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    if (currentGraph && (currentGraph.nodes.length > 0 || (currentGraph.drawings?.length ?? 0) > 0)) {
      for (const node of currentGraph.nodes) {
        const position = nodePositionsRef.current.get(node.id) ?? node.position;
        const visual = nodeVisualsRef.current.get(node.id);
        const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
        const nodeWidth = visual?.width ?? dimensions.width;
        const nodeHeight = visual
          ? visual.height + visual.projectedGraphicsHeight
          : dimensions.height;

        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        maxX = Math.max(maxX, position.x + nodeWidth);
        maxY = Math.max(maxY, position.y + nodeHeight);
      }

      for (const drawing of currentGraph.drawings ?? []) {
        const drawingPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        minX = Math.min(minX, drawingPosition.x);
        minY = Math.min(minY, drawingPosition.y);
        maxX = Math.max(maxX, drawingPosition.x + 140);
        maxY = Math.max(maxY, drawingPosition.y + 26);

        for (const path of drawing.paths) {
          for (const point of path.points) {
            const worldX = drawingPosition.x + point.x;
            const worldY = drawingPosition.y + point.y;
            minX = Math.min(minX, worldX);
            minY = Math.min(minY, worldY);
            maxX = Math.max(maxX, worldX);
            maxY = Math.max(maxY, worldY);
          }
        }
      }
    } else {
      minX = viewMinX - 100;
      minY = viewMinY - 100;
      maxX = viewMaxX + 100;
      maxY = viewMaxY + 100;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      minX = viewMinX - 100;
      minY = viewMinY - 100;
      maxX = viewMaxX + 100;
      maxY = viewMaxY + 100;
    }

    const minimapWorldPadding = 120;
    minX -= minimapWorldPadding;
    minY -= minimapWorldPadding;
    maxX += minimapWorldPadding;
    maxY += minimapWorldPadding;

    const worldWidth = Math.max(maxX - minX, 1);
    const worldHeight = Math.max(maxY - minY, 1);
    const innerWidth = cssWidth - MINIMAP_PADDING * 2;
    const innerHeight = cssHeight - MINIMAP_PADDING * 2;
    const scale = Math.min(innerWidth / worldWidth, innerHeight / worldHeight);
    const offsetX = MINIMAP_PADDING + (innerWidth - worldWidth * scale) * 0.5;
    const offsetY = MINIMAP_PADDING + (innerHeight - worldHeight * scale) * 0.5;

    minimapTransformRef.current = {
      minX,
      minY,
      maxX,
      maxY,
      scale,
      offsetX,
      offsetY,
    };

    if (currentGraph) {
      for (const node of currentGraph.nodes) {
        const position = nodePositionsRef.current.get(node.id) ?? node.position;
        const visual = nodeVisualsRef.current.get(node.id);
        const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
        const nodeWidth = visual?.width ?? dimensions.width;
        const nodeHeight = visual
          ? visual.height + visual.projectedGraphicsHeight
          : dimensions.height;

        const x = offsetX + (position.x - minX) * scale;
        const y = offsetY + (position.y - minY) * scale;
        const w = nodeWidth * scale;
        const h = nodeHeight * scale;

        ctx.fillStyle = selectedNodeIdRef.current === node.id ? 'rgba(59, 130, 246, 0.75)' : 'rgba(203, 213, 225, 0.95)';
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }

      for (const drawing of currentGraph.drawings ?? []) {
        const position = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        const x = offsetX + (position.x - minX) * scale;
        const y = offsetY + (position.y - minY) * scale;
        const w = Math.max(26 * scale, 10);
        const h = Math.max(12 * scale, 6);
        ctx.fillStyle = selectedDrawingIdRef.current === drawing.id
          ? 'rgba(14, 165, 233, 0.9)'
          : 'rgba(15, 118, 110, 0.75)';
        ctx.fillRect(x, y, w, h);

        ctx.strokeStyle = 'rgba(241, 245, 249, 0.9)';
        ctx.lineWidth = 1;
        for (const path of drawing.paths) {
          if (path.points.length < 2) {
            continue;
          }
          ctx.beginPath();
          const first = path.points[0];
          ctx.moveTo(
            offsetX + ((position.x + first.x) - minX) * scale,
            offsetY + ((position.y + first.y) - minY) * scale
          );
          for (let i = 1; i < path.points.length; i += 1) {
            const point = path.points[i];
            ctx.lineTo(
              offsetX + ((position.x + point.x) - minX) * scale,
              offsetY + ((position.y + point.y) - minY) * scale
            );
          }
          ctx.stroke();
        }
      }
    }

    const viewX = offsetX + (viewMinX - minX) * scale;
    const viewY = offsetY + (viewMinY - minY) * scale;
    const viewW = (viewMaxX - viewMinX) * scale;
    const viewH = (viewMaxY - viewMinY) * scale;
    ctx.strokeStyle = 'rgba(59, 130, 246, 1)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(viewX, viewY, viewW, viewH);
  }, []);

  const updateTextResolutionForScale = useCallback((scale: number) => {
    const nextResolution = clamp(
      PIXEL_RATIO * Math.max(scale, 1),
      PIXEL_RATIO,
      MAX_TEXT_RESOLUTION
    );

    for (const textNode of textNodesRef.current) {
      if (Math.abs(textNode.resolution - nextResolution) > 0.01) {
        textNode.resolution = nextResolution;
      }
    }
  }, []);

  const centerViewportAtWorldPoint = useCallback((worldX: number, worldY: number) => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) {
      return;
    }

    const scale = viewport.scale.x || 1;
    viewport.position.set(
      snapToPixel(app.screen.width * 0.5 - worldX * scale),
      snapToPixel(app.screen.height * 0.5 - worldY * scale)
    );
    requestCanvasAnimationLoop();
    requestViewportDrivenGraphRefresh();
  }, [requestCanvasAnimationLoop, requestViewportDrivenGraphRefresh]);

  const handleMinimapPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const transform = minimapTransformRef.current;
    const canvas = minimapCanvasRef.current;
    if (!transform || !canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const worldX = clamp(
      transform.minX + (x - transform.offsetX) / transform.scale,
      transform.minX,
      transform.maxX
    );
    const worldY = clamp(
      transform.minY + (y - transform.offsetY) / transform.scale,
      transform.minY,
      transform.maxY
    );

    centerViewportAtWorldPoint(worldX, worldY);
    drawMinimap();
  }, [centerViewportAtWorldPoint, drawMinimap]);

  const setInputPortHighlight = useCallback((portKey: string, highlighted: boolean) => {
    const marker = inputPortMarkersRef.current.get(portKey);
    if (marker) {
      drawInputPortMarker(marker, highlighted);
      requestCanvasAnimationLoop();
    }
  }, [requestCanvasAnimationLoop]);

  const setOutputPortHighlight = useCallback((portKey: string, highlighted: boolean) => {
    const marker = outputPortMarkersRef.current.get(portKey);
    if (marker) {
      drawOutputPortMarker(marker, highlighted);
      requestCanvasAnimationLoop();
    }
  }, [requestCanvasAnimationLoop]);

  const syncNodePortPositions = useCallback((nodeId: string, position: Position, visual: NodeVisual) => {
    for (const [portName, offsetY] of visual.inputPortOffsets.entries()) {
      inputPortPositionsRef.current.set(makePortKey(nodeId, portName), {
        x: position.x,
        y: position.y + offsetY,
      });
    }

    for (const [portName, offsetY] of visual.outputPortOffsets.entries()) {
      outputPortPositionsRef.current.set(makePortKey(nodeId, portName), {
        x: position.x + visual.width,
        y: position.y + offsetY,
      });
    }
  }, []);

  const destroyNodeGraphicsTexture = useCallback((texture: Texture) => {
    if (texture === Texture.WHITE) {
      return;
    }

    texture.destroy(true);
  }, []);

  const releaseTextureSource = useCallback((source: string) => {
    const cached = graphicsTextureCacheRef.current.get(source);
    if (!cached) {
      return;
    }

    if (cached.refCount <= 1) {
      const pendingTexture = pendingGraphicsTextureLoadsRef.current.get(source);
      if (pendingTexture === cached.texture) {
        pendingGraphicsTextureLoadsRef.current.delete(source);
      }
      destroyNodeGraphicsTexture(cached.texture);
      graphicsTextureCacheRef.current.delete(source);
      return;
    }

    cached.refCount -= 1;
  }, [destroyNodeGraphicsTexture]);

  const queueNodeGraphicsTextureRefresh = useCallback((source: string, texture: Texture) => {
    const pendingTexture = pendingGraphicsTextureLoadsRef.current.get(source);
    if (texture.baseTexture.valid) {
      if (pendingTexture === texture) {
        pendingGraphicsTextureLoadsRef.current.delete(source);
      }
      return;
    }

    if (pendingTexture === texture) {
      return;
    }

    pendingGraphicsTextureLoadsRef.current.set(source, texture);
    const clearPendingTexture = () => {
      if (pendingGraphicsTextureLoadsRef.current.get(source) === texture) {
        pendingGraphicsTextureLoadsRef.current.delete(source);
      }
    };
    const scheduleGraphicsRefresh = () => {
      if (!texture.baseTexture.valid) {
        return;
      }
      clearPendingTexture();
      requestCanvasAnimationLoop();
      renderGraphRef.current();
    };

    texture.baseTexture.once('loaded', scheduleGraphicsRefresh);
    texture.baseTexture.once('update', scheduleGraphicsRefresh);
    texture.baseTexture.once('error', () => {
      clearPendingTexture();
    });
  }, [requestCanvasAnimationLoop]);

  const retainTextureSource = useCallback((source: string): GraphicsTextureCacheEntry => {
    let cached = graphicsTextureCacheRef.current.get(source);
    if (!cached) {
      cached = { texture: Texture.from(source), refCount: 0 };
      graphicsTextureCacheRef.current.set(source, cached);
    }

    cached.refCount += 1;
    queueNodeGraphicsTextureRefresh(source, cached.texture);
    return cached;
  }, [queueNodeGraphicsTextureRefresh]);

  const getNodeGraphicsTextureForNode = useCallback((nodeId: string, source: string): Texture => {
    const currentSource = nodeGraphicsTextureBindingsRef.current.get(nodeId);
    const pendingSource = nodePendingGraphicsTextureBindingsRef.current.get(nodeId);
    if (pendingSource && pendingSource !== source) {
      releaseTextureSource(pendingSource);
      nodePendingGraphicsTextureBindingsRef.current.delete(nodeId);
    }

    if (currentSource === source) {
      const existing = graphicsTextureCacheRef.current.get(source);
      if (existing) {
        queueNodeGraphicsTextureRefresh(source, existing.texture);
        return existing.texture;
      }

      return retainTextureSource(source).texture;
    }

    if (pendingSource !== source) {
      retainTextureSource(source);
      nodePendingGraphicsTextureBindingsRef.current.set(nodeId, source);
    }

    const nextTexture = graphicsTextureCacheRef.current.get(source)?.texture;
    const canPromoteImmediately = Boolean(nextTexture && (nextTexture.baseTexture.valid || !currentSource));
    if (nextTexture && canPromoteImmediately) {
      if (currentSource) {
        releaseTextureSource(currentSource);
      }
      nodeGraphicsTextureBindingsRef.current.set(nodeId, source);
      nodePendingGraphicsTextureBindingsRef.current.delete(nodeId);
      return nextTexture;
    }

    if (currentSource) {
      const currentTexture = graphicsTextureCacheRef.current.get(currentSource)?.texture;
      if (currentTexture) {
        queueNodeGraphicsTextureRefresh(currentSource, currentTexture);
        return currentTexture;
      }
    }

    if (nextTexture) {
      nodeGraphicsTextureBindingsRef.current.set(nodeId, source);
      nodePendingGraphicsTextureBindingsRef.current.delete(nodeId);
      return nextTexture;
    }

    const retained = retainTextureSource(source);
    nodeGraphicsTextureBindingsRef.current.set(nodeId, source);
    nodePendingGraphicsTextureBindingsRef.current.delete(nodeId);
    return retained.texture;
  }, [queueNodeGraphicsTextureRefresh, releaseTextureSource, retainTextureSource]);

  const releaseUnusedNodeGraphicsTextures = useCallback((activeNodeIds: Set<string>) => {
    for (const [nodeId, source] of nodeGraphicsTextureBindingsRef.current.entries()) {
      if (activeNodeIds.has(nodeId)) {
        continue;
      }

      releaseTextureSource(source);
      nodeGraphicsTextureBindingsRef.current.delete(nodeId);
    }

    for (const [nodeId, source] of nodePendingGraphicsTextureBindingsRef.current.entries()) {
      if (activeNodeIds.has(nodeId)) {
        continue;
      }

      releaseTextureSource(source);
      nodePendingGraphicsTextureBindingsRef.current.delete(nodeId);
    }
  }, [releaseTextureSource]);

  const clearAllNodeGraphicsTextures = useCallback(() => {
    for (const cacheEntry of graphicsTextureCacheRef.current.values()) {
      destroyNodeGraphicsTexture(cacheEntry.texture);
    }
    graphicsTextureCacheRef.current.clear();
    nodeGraphicsTextureBindingsRef.current.clear();
    nodePendingGraphicsTextureBindingsRef.current.clear();
    pendingGraphicsTextureLoadsRef.current.clear();
  }, [destroyNodeGraphicsTexture]);

  const pickConnectionAtClientPoint = useCallback((clientX: number, clientY: number): string | null => {
    const viewport = viewportRef.current;
    const app = appRef.current;
    if (!viewport) {
      return null;
    }
    if (!app) {
      return null;
    }

    const canvasRect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    const localX = clientX - canvasRect.left;
    const localY = clientY - canvasRect.top;
    const worldPoint = viewport.toLocal(new Point(localX, localY));
    const scale = Math.max(viewport.scale.x, 0.1);
    const maxDistanceWorld = EDGE_HIT_WIDTH / scale;
    const maxDistanceSquared = maxDistanceWorld * maxDistanceWorld;

    let pickedId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [connectionId, geometry] of connectionGeometriesRef.current.entries()) {
      const distanceSquared = distanceSquaredToBezier(worldPoint.x, worldPoint.y, geometry);
      if (distanceSquared <= maxDistanceSquared && distanceSquared < bestDistance) {
        bestDistance = distanceSquared;
        pickedId = connectionId;
      }
    }

    return pickedId;
  }, []);

  const drawConnections = useCallback(() => {
    const edges = edgeLayerRef.current;
    const currentGraph = graphRef.current;

    if (!edges) return;

    requestCanvasAnimationLoop();
    edges.clear();
    connectionGeometriesRef.current.clear();
    if (!currentGraph) return;
    const viewportScale = Math.max(viewportRef.current?.scale.x ?? 1, 0.1);
    const connectionLineWidth = CONNECTION_WIRE_SCREEN_WIDTH / viewportScale;

    for (const connection of currentGraph.connections) {
      const sourceVisual = nodeVisualsRef.current.get(connection.sourceNodeId);
      const targetVisual = nodeVisualsRef.current.get(connection.targetNodeId);
      const sourcePosition = nodePositionsRef.current.get(connection.sourceNodeId);
      const targetPosition = nodePositionsRef.current.get(connection.targetNodeId);

      if (!sourceVisual || !targetVisual || !sourcePosition || !targetPosition) {
        continue;
      }

      const sourceY =
        sourceVisual.outputPortOffsets.get(connection.sourcePort) ?? sourceVisual.height / 2;
      const targetY =
        targetVisual.inputPortOffsets.get(connection.targetPort) ?? targetVisual.height / 2;

      const startX = sourcePosition.x + sourceVisual.width;
      const startY = sourcePosition.y + sourceY;
      const endX = targetPosition.x;
      const endY = targetPosition.y + targetY;
      const geometry = getBezierGeometry(connection.id, startX, startY, endX, endY);
      connectionGeometriesRef.current.set(connection.id, geometry);
      const isSelectedConnection = selectedConnectionIdRef.current === connection.id;
      edges.lineStyle(connectionLineWidth, isSelectedConnection ? 0x1d4ed8 : 0x64748b, CONNECTION_WIRE_ALPHA);
      drawBezierConnection(edges, startX, startY, endX, endY);
    }

    const dragState = connectionDragStateRef.current;
    if (!dragState) return;

    let endX = dragState.startX;
    let endY = dragState.startY;

    if (dragState.hoveredInputKey) {
      const hoveredPosition = inputPortPositionsRef.current.get(dragState.hoveredInputKey);
      if (hoveredPosition) {
        endX = hoveredPosition.x;
        endY = hoveredPosition.y;
      }
    } else {
      const viewport = viewportRef.current;
      if (viewport) {
        const worldPoint = viewport.toLocal(new Point(dragState.pointerX, dragState.pointerY));
        endX = worldPoint.x;
        endY = worldPoint.y;
      }
    }

    edges.lineStyle(connectionLineWidth, 0x1d4ed8, CONNECTION_WIRE_ALPHA);
    drawBezierConnection(edges, dragState.startX, dragState.startY, endX, endY);
  }, [requestCanvasAnimationLoop]);

  const drawFreehandStrokes = useCallback(() => {
    const drawLayer = drawLayerRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;
    if (!drawLayer || !viewport) {
      return;
    }

    requestCanvasAnimationLoop();
    drawLayer.clear();
    const viewportScale = Math.max(viewport.scale.x, 0.1);

    const drawPath = (path: DrawingPath, origin: Position) => {
      if (path.points.length === 0) {
        return;
      }

      const lineWidth = Math.max(path.thickness / viewportScale, 0.5 / viewportScale);
      const color = resolvePencilColor(path.color);
      drawLayer.lineStyle(lineWidth, color, 0.95, 0.5, false);

      if (path.points.length === 1) {
        const point = path.points[0];
        drawLayer.beginFill(color, 0.95);
        drawLayer.drawCircle(origin.x + point.x, origin.y + point.y, lineWidth * 0.5);
        drawLayer.endFill();
        return;
      }

      drawLayer.moveTo(origin.x + path.points[0].x, origin.y + path.points[0].y);
      for (let i = 1; i < path.points.length; i += 1) {
        drawLayer.lineTo(origin.x + path.points[i].x, origin.y + path.points[i].y);
      }
    };

    for (const drawing of currentGraph?.drawings ?? []) {
      const drawingPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
      for (const path of drawing.paths) {
        drawPath(path, drawingPosition);
      }
    }

    const activePath = activeDrawingPathRef.current;
    if (activePath) {
      const drawing = currentGraph?.drawings?.find((candidate) => candidate.id === activePath.drawingId);
      if (drawing) {
        const drawingPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        drawPath(activePath.path, drawingPosition);
      }
    }
  }, [requestCanvasAnimationLoop]);

  const enqueueLightningForConnection = useCallback((connectionId: string) => {
    const now = performance.now();
    requestCanvasAnimationLoop();
    lightningPulsesRef.current = [
      ...lightningPulsesRef.current.filter(
        (pulse) => !(pulse.connectionId === connectionId && now - pulse.startAt < pulse.durationMs * 0.35)
      ),
      {
        connectionId,
        startAt: now,
        durationMs: LIGHTNING_DURATION_MS,
      },
    ];
  }, [requestCanvasAnimationLoop]);

  const enqueueLightningForNodeInputs = useCallback((nodeId: string) => {
    const currentGraph = graphRef.current;
    if (!currentGraph) {
      return;
    }

    for (const connection of currentGraph.connections) {
      if (connection.targetNodeId === nodeId) {
        enqueueLightningForConnection(connection.id);
      }
    }
  }, [enqueueLightningForConnection]);

  const enqueueNodeShock = useCallback((nodeId: string) => {
    const now = performance.now();
    requestCanvasAnimationLoop();
    nodeShocksRef.current = [
      ...nodeShocksRef.current.filter(
        (shock) => !(shock.nodeId === nodeId && now - shock.startAt < shock.durationMs * 0.4)
      ),
      {
        nodeId,
        startAt: now,
        durationMs: NODE_SHOCK_DURATION_MS,
      },
    ];
  }, [requestCanvasAnimationLoop]);

  const drawEffects = useCallback(() => {
    const effectsLayer = effectsLayerRef.current;
    if (!effectsLayer) {
      return;
    }

    effectsLayer.clear();
    const now = performance.now();
    const currentGraph = graphRef.current;

    if (currentGraph) {
      const erroredNodeIds = new Set<string>();
      for (const [nodeId, state] of Object.entries(nodeExecutionStatesRef.current)) {
        if (state?.hasError) {
          erroredNodeIds.add(nodeId);
        }
      }

      for (const nodeId of erroredNodeIds) {
        const visual = nodeVisualsRef.current.get(nodeId);
        const position = nodePositionsRef.current.get(nodeId);
        if (!visual || !position) {
          continue;
        }

        const lastEmittedAt = lastSmokeEmitAtRef.current.get(nodeId) ?? (now - SMOKE_EMIT_INTERVAL_MS);
        if (now - lastEmittedAt >= SMOKE_EMIT_INTERVAL_MS) {
          smokePuffsRef.current.push({
            nodeId,
            startAt: now,
            durationMs: SMOKE_MIN_DURATION_MS + Math.random() * (SMOKE_MAX_DURATION_MS - SMOKE_MIN_DURATION_MS),
            originX: position.x + visual.width - 14 + (Math.random() - 0.5) * 5,
            originY: position.y + 12 + (Math.random() - 0.5) * 3,
            driftX: (Math.random() - 0.5) * 18,
            driftY: -24 - Math.random() * 24,
            startRadius: 2.8 + Math.random() * 2.2,
            startAlpha: 0.2 + Math.random() * 0.18,
            wobblePhase: Math.random() * Math.PI * 2,
          });
          lastSmokeEmitAtRef.current.set(nodeId, now);
        }
      }

      for (const nodeId of Array.from(lastSmokeEmitAtRef.current.keys())) {
        if (!erroredNodeIds.has(nodeId)) {
          lastSmokeEmitAtRef.current.delete(nodeId);
        }
      }
    }

    smokePuffsRef.current = smokePuffsRef.current.filter((puff) => {
      const age = (now - puff.startAt) / puff.durationMs;
      if (age < 0 || age >= 1) {
        return false;
      }

      const fade = 1 - age;
      const radius = puff.startRadius + (age * 7.5);
      const x = puff.originX + (puff.driftX * age) + Math.sin((age * 10) + puff.wobblePhase) * (1 + age * 1.8);
      const y = puff.originY + (puff.driftY * age);
      const alpha = puff.startAlpha * fade * fade;

      effectsLayer.beginFill(0x020617, alpha);
      effectsLayer.drawCircle(x, y, radius);
      effectsLayer.endFill();
      effectsLayer.beginFill(0x0f172a, alpha * 0.55);
      effectsLayer.drawCircle(x - (radius * 0.15), y - (radius * 0.25), radius * 0.58);
      effectsLayer.endFill();

      return true;
    });

    if (smokePuffsRef.current.length > SMOKE_MAX_PARTICLES) {
      smokePuffsRef.current.splice(0, smokePuffsRef.current.length - SMOKE_MAX_PARTICLES);
    }

    lightningPulsesRef.current = lightningPulsesRef.current.filter((pulse) => {
      const geometry = connectionGeometriesRef.current.get(pulse.connectionId);
      if (!geometry) {
        return now - pulse.startAt < pulse.durationMs;
      }

      const progress = (now - pulse.startAt) / pulse.durationMs;
      if (progress < 0 || progress >= 1) {
        return false;
      }

      const headT = clamp(progress, 0, 1);
      const tailT = clamp(headT - 0.5, 0, headT);
      const alpha = 1 - progress;
      const samples = 20;

      // Draw a soft full-path glow so activity is immediately visible.
      effectsLayer.lineStyle(8, 0x93c5fd, 0.55 * alpha);
      drawBezierConnection(
        effectsLayer,
        geometry.startX,
        geometry.startY,
        geometry.endX,
        geometry.endY
      );

      effectsLayer.lineStyle(5.5, 0xe0f2fe, 1 * alpha);
      let started = false;
      for (let i = 0; i <= samples; i += 1) {
        const ratio = i / samples;
        const t = tailT + (headT - tailT) * ratio;
        const point = pointOnBezier(geometry, t);
        const tangent = tangentOnBezier(geometry, t);
        const normal = normalizeVector(-tangent.y, tangent.x);
        const jitter =
          Math.sin((t * 52) + (progress * 22) + (i * 0.7)) * (2.8 * (1 - ratio * 0.45));
        const x = point.x + normal.x * jitter;
        const y = point.y + normal.y * jitter;

        if (!started) {
          effectsLayer.moveTo(x, y);
          started = true;
        } else {
          effectsLayer.lineTo(x, y);
        }
      }

      effectsLayer.lineStyle(2, 0xffffff, 0.95 * alpha);
      started = false;
      for (let i = 0; i <= samples; i += 1) {
        const ratio = i / samples;
        const t = tailT + (headT - tailT) * ratio;
        const point = pointOnBezier(geometry, t);
        if (!started) {
          effectsLayer.moveTo(point.x, point.y);
          started = true;
        } else {
          effectsLayer.lineTo(point.x, point.y);
        }
      }

      const headPoint = pointOnBezier(geometry, headT);
      effectsLayer.beginFill(0xf8fbff, 0.95 * alpha);
      effectsLayer.drawCircle(headPoint.x, headPoint.y, 4.5);
      effectsLayer.endFill();
      effectsLayer.lineStyle(1.4, 0xbfdbfe, 0.8 * alpha);
      effectsLayer.drawCircle(headPoint.x, headPoint.y, 8.5);

      return true;
    });

    nodeShocksRef.current = nodeShocksRef.current.filter((shock) => {
      const visual = nodeVisualsRef.current.get(shock.nodeId);
      const position = nodePositionsRef.current.get(shock.nodeId);
      if (!visual || !position) {
        return now - shock.startAt < shock.durationMs;
      }

      const progress = (now - shock.startAt) / shock.durationMs;
      if (progress < 0 || progress >= 1) {
        return false;
      }

      const alpha = 1 - progress;
      const glowExpand = 6 + progress * 10;
      effectsLayer.lineStyle(2.2, 0xe2f0ff, 0.75 * alpha);
      effectsLayer.drawRoundedRect(
        position.x - glowExpand,
        position.y - glowExpand,
        visual.width + glowExpand * 2,
        visual.height + glowExpand * 2,
        12 + glowExpand * 0.35
      );

      const statusX = position.x + visual.width - 14;
      const statusY = position.y + 14;
      effectsLayer.lineStyle(1.6, 0xffffff, 0.65 * alpha);
      effectsLayer.drawCircle(statusX, statusY, 7 + progress * 11);
      effectsLayer.lineStyle(1, 0x93c5fd, 0.55 * alpha);
      effectsLayer.drawCircle(statusX, statusY, 4 + progress * 7);

      return true;
    });
    pauseCanvasAnimationLoopIfIdle();
  }, [pauseCanvasAnimationLoopIfIdle]);

  const fitViewportToGraph = useCallback(() => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;

    if (!app || !viewport) return;

    if (!currentGraph || (currentGraph.nodes.length === 0 && (currentGraph.drawings?.length ?? 0) === 0)) {
      viewport.scale.set(1);
      viewport.position.set(app.screen.width / 2, app.screen.height / 2);
      updateTextResolutionForScale(1);
      drawMinimap();
      requestViewportDrivenGraphRefresh();
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const node of currentGraph.nodes) {
      const visual = nodeVisualsRef.current.get(node.id);
      const position = nodePositionsRef.current.get(node.id);
      if (!visual || !position) continue;

      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + visual.width);
      maxY = Math.max(maxY, position.y + visual.height + visual.projectedGraphicsHeight);
    }

    for (const drawing of currentGraph.drawings ?? []) {
      const position = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + 160);
      maxY = Math.max(maxY, position.y + 30);

      for (const path of drawing.paths) {
        for (const point of path.points) {
          const worldX = position.x + point.x;
          const worldY = position.y + point.y;
          minX = Math.min(minX, worldX);
          minY = Math.min(minY, worldY);
          maxX = Math.max(maxX, worldX);
          maxY = Math.max(maxY, worldY);
        }
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      viewport.scale.set(1);
      viewport.position.set(app.screen.width / 2, app.screen.height / 2);
      updateTextResolutionForScale(1);
      drawMinimap();
      requestViewportDrivenGraphRefresh();
      return;
    }

    const graphWidth = Math.max(maxX - minX, 1);
    const graphHeight = Math.max(maxY - minY, 1);
    const fitScaleX = (app.screen.width - VIEWPORT_MARGIN * 2) / graphWidth;
    const fitScaleY = (app.screen.height - VIEWPORT_MARGIN * 2) / graphHeight;
    const nextScale = clamp(Math.min(fitScaleX, fitScaleY, 1), MIN_ZOOM, MAX_ZOOM);

    viewport.scale.set(nextScale);
    viewport.position.set(
      snapToPixel(app.screen.width / 2 - ((minX + maxX) / 2) * nextScale),
      snapToPixel(app.screen.height / 2 - ((minY + maxY) / 2) * nextScale)
    );
    updateTextResolutionForScale(nextScale);
    drawMinimap();
    requestViewportDrivenGraphRefresh();
  }, [drawMinimap, requestViewportDrivenGraphRefresh, updateTextResolutionForScale]);

  const buildProjectionTargetNodeVisualMap = useCallback((targetGraph: typeof graph): Map<string, ProjectionNodeVisualState> => {
    const map = new Map<string, ProjectionNodeVisualState>();
    if (!targetGraph) {
      return map;
    }

    for (const node of targetGraph.nodes) {
      const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
      map.set(node.id, {
        position: {
          x: node.position.x,
          y: node.position.y,
        },
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    return map;
  }, []);

  const startProjectionTransition = useCallback((previousGraph: typeof graph, nextGraph: typeof graph) => {
    if (!previousGraph || !nextGraph) {
      projectionTransitionRef.current = null;
      return;
    }

    const fromNodes = new Map<string, ProjectionNodeVisualState>();
    for (const node of previousGraph.nodes) {
      const renderedPosition = nodePositionsRef.current.get(node.id) ?? node.position;
      const renderedVisual = nodeVisualsRef.current.get(node.id);
      const fallbackDimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
      fromNodes.set(node.id, {
        position: {
          x: renderedPosition.x,
          y: renderedPosition.y,
        },
        width: renderedVisual?.width ?? fallbackDimensions.width,
        height: renderedVisual?.height ?? fallbackDimensions.height,
      });
    }

    projectionTransitionRef.current = {
      graphId: nextGraph.id,
      fromProjectionId: previousGraph.activeProjectionId ?? 'unknown',
      toProjectionId: nextGraph.activeProjectionId ?? 'unknown',
      fromBackground: lastResolvedCanvasBackgroundRef.current,
      toBackground: resolveGraphCanvasBackground(nextGraph),
      fromNodes,
      toNodes: buildProjectionTargetNodeVisualMap(nextGraph),
      startAt: performance.now(),
      durationMs: PROJECTION_TRANSITION_DURATION_MS,
    };
  }, [buildProjectionTargetNodeVisualMap]);

  const endConnectionDrag = useCallback((commit: boolean) => {
    const dragState = connectionDragStateRef.current;
    if (!dragState) return;

    const previousHoveredInput = dragState.hoveredInputKey;
    const previousSourceOutput = dragState.sourcePortKey;

    if (commit && previousHoveredInput) {
      const currentGraph = graphRef.current;
      const { nodeId: targetNodeId, portName: targetPort } = parsePortKey(previousHoveredInput);
      if (currentGraph && targetPort) {
        const alreadyExists = currentGraph.connections.some(
          (connection) =>
            connection.sourceNodeId === dragState.sourceNodeId &&
            connection.sourcePort === dragState.sourcePort &&
            connection.targetNodeId === targetNodeId &&
            connection.targetPort === targetPort
        );

        const introducesCycle = createsCycle(
          currentGraph.nodes,
          dragState.sourceNodeId,
          targetNodeId,
          currentGraph.connections
        );

        if (!alreadyExists && !introducesCycle) {
          addConnection({
            id: uuidv4(),
            sourceNodeId: dragState.sourceNodeId,
            sourcePort: dragState.sourcePort,
            targetNodeId,
            targetPort,
          });
        }
      }
    }

    connectionDragStateRef.current = null;
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;
    setInputPortHighlight(previousHoveredInput || '', false);
    setOutputPortHighlight(previousSourceOutput || '', false);
    drawConnections();
  }, [addConnection, drawConnections, setInputPortHighlight, setOutputPortHighlight]);

  const updateNumericSliderFromPointer = useCallback((nodeId: string, pointerX: number, pointerY: number) => {
    const slider = numericSliderVisualsRef.current.get(nodeId);
    if (!slider) {
      return;
    }

    const localPoint = slider.nodeContainer.toLocal(new Point(pointerX, pointerY));
    const nextValue = resolveNumericSliderValue(localPoint.x, slider);
    if (nextValue !== slider.value) {
      slider.value = nextValue;
      drawNumericSliderVisual(slider);
    }

    const dragState = numericSliderDragStateRef.current;
    if (dragState?.nodeId === nodeId) {
      dragState.currentValue = nextValue;
    }
  }, []);

  const commitNumericSliderValue = useCallback((nodeId: string, nextValue: number) => {
    const currentGraph = graphRef.current;
    const node = currentGraph?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== NodeType.NUMERIC_INPUT) {
      return;
    }

    const currentConfig = normalizeNumericInputConfig(node.config.config as Record<string, unknown> | undefined);
    const value = snapNumericInputValue(nextValue, currentConfig.min, currentConfig.max, currentConfig.step);
    if (value === currentConfig.value) {
      return;
    }

    updateNode(nodeId, {
      config: {
        ...node.config,
        config: {
          ...(node.config.config ?? {}),
          min: currentConfig.min,
          max: currentConfig.max,
          step: currentConfig.step,
          value,
        },
      },
    });
  }, [updateNode]);

  const renderGraph = useCallback(() => {
    const nodesLayer = nodeLayerRef.current;
    const drawingHandleLayer = drawingHandleLayerRef.current;
    const currentGraph = graphRef.current;
    const app = appRef.current;
    const viewportContainer = viewportRef.current;
    const viewportWorldBounds =
      app && viewportContainer ? getViewportWorldBounds(app, viewportContainer) : null;
    const canEvaluateViewportGraphics = Boolean(viewportWorldBounds && viewportInitializedRef.current);
    const viewportScale = viewportContainer
      ? Math.max(Math.abs(viewportContainer.scale.x || 1), 0.0001)
      : 1;
    const nextAnnotationOverlayTransform: AnnotationOverlayTransform = viewportContainer
      ? {
        x: snapToPixel(viewportContainer.position.x),
        y: snapToPixel(viewportContainer.position.y),
        scale: viewportScale,
      }
      : { x: 0, y: 0, scale: 1 };
    const previousAnnotationOverlayTransform = annotationOverlayTransformRef.current;
    if (
      previousAnnotationOverlayTransform.x !== nextAnnotationOverlayTransform.x ||
      previousAnnotationOverlayTransform.y !== nextAnnotationOverlayTransform.y ||
      Math.abs(previousAnnotationOverlayTransform.scale - nextAnnotationOverlayTransform.scale) > 0.0001
    ) {
      annotationOverlayTransformRef.current = nextAnnotationOverlayTransform;
      setAnnotationOverlayTransform(nextAnnotationOverlayTransform);
    }
    const now = performance.now();
    let activeProjectionTransition = projectionTransitionRef.current;
    let projectionTransitionProgress = 1;
    let projectionTransitionEasedProgress = 1;

    if (activeProjectionTransition) {
      if (!currentGraph || activeProjectionTransition.graphId !== currentGraph.id) {
        projectionTransitionRef.current = null;
        activeProjectionTransition = null;
      } else {
        projectionTransitionProgress = clamp(
          (now - activeProjectionTransition.startAt) / activeProjectionTransition.durationMs,
          0,
          1
        );
        projectionTransitionEasedProgress = easeInOutCubic(projectionTransitionProgress);
        if (projectionTransitionProgress >= 1) {
          projectionTransitionRef.current = null;
          activeProjectionTransition = null;
        }
      }
    }
    const isProjectionTransitionActive = Boolean(activeProjectionTransition);
    const resolvedCanvasBackground = currentGraph
      ? (
        isProjectionTransitionActive && activeProjectionTransition
          ? interpolateCanvasBackground(
            activeProjectionTransition.fromBackground,
            activeProjectionTransition.toBackground,
            projectionTransitionEasedProgress
          )
          : resolveGraphCanvasBackground(currentGraph)
      )
      : resolveGraphCanvasBackground(null);

    if (!nodesLayer || !drawingHandleLayer) return;

    requestCanvasAnimationLoop();
    refreshCanvasBackgroundTexture(resolvedCanvasBackground);
    const staleNodeObjects = nodesLayer.removeChildren();
    for (const displayObject of staleNodeObjects) {
      displayObject.destroy({ children: true });
    }
    const staleDrawingObjects = drawingHandleLayer.removeChildren();
    for (const displayObject of staleDrawingObjects) {
      displayObject.destroy({ children: true });
    }
    nodeVisualsRef.current.clear();
    drawingVisualsRef.current.clear();
    numericSliderVisualsRef.current.clear();
    nodePositionsRef.current.clear();
    drawingPositionsRef.current.clear();
    textNodesRef.current.clear();
    inputPortMarkersRef.current.clear();
    outputPortMarkersRef.current.clear();
    inputPortPositionsRef.current.clear();
    outputPortPositionsRef.current.clear();
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;

    if (!currentGraph) {
      hoveredNumericSliderNodeIdRef.current = null;
      hoveredNodeResizeHandleRef.current = null;
      nodeCardDraftSizesRef.current.clear();
      nodeCardDraftPositionsRef.current.clear();
      if (annotationOverlaysRef.current.length > 0) {
        annotationOverlaysRef.current = [];
        setAnnotationOverlays([]);
      }
      clearAllNodeGraphicsTextures();
      if (selectedNodeGraphicsDebugRef.current !== null) {
        selectedNodeGraphicsDebugRef.current = null;
        setSelectedNodeGraphicsDebug(null);
      }
      drawConnections();
      drawFreehandStrokes();
      return;
    }

    if (
      hoveredNumericSliderNodeIdRef.current &&
      !currentGraph.nodes.some(
        (node) => node.id === hoveredNumericSliderNodeIdRef.current && node.type === NodeType.NUMERIC_INPUT
      )
    ) {
      hoveredNumericSliderNodeIdRef.current = null;
    }

    if (
      hoveredNodeResizeHandleRef.current &&
      (
        !currentGraph.nodes.some((node) => node.id === hoveredNodeResizeHandleRef.current?.nodeId) ||
        selectedNodeIdRef.current !== hoveredNodeResizeHandleRef.current?.nodeId
      )
    ) {
      hoveredNodeResizeHandleRef.current = null;
    }

    const currentNodeIds = new Set(currentGraph.nodes.map((node) => node.id));
    for (const nodeId of nodeCardDraftSizesRef.current.keys()) {
      if (!currentNodeIds.has(nodeId)) {
        nodeCardDraftSizesRef.current.delete(nodeId);
      }
    }
    for (const nodeId of nodeCardDraftPositionsRef.current.keys()) {
      if (!currentNodeIds.has(nodeId)) {
        nodeCardDraftPositionsRef.current.delete(nodeId);
      }
    }

    const activeNodeGraphicsTextureIds = new Set<string>();
    let selectedNodeGraphicsDebugNext: NodeGraphicsComputationDebug | null = null;
    const nextAnnotationOverlays: AnnotationOverlayEntry[] = [];
    const selectedNodeIdValue = selectedNodeIdRef.current;
    const activeNodeDragState = nodeDragStateRef.current;

    for (const node of currentGraph.nodes) {
      const dimensions = resolveNodeCardDimensions(node, nodeCardDraftSizesRef.current.get(node.id));
      const dragStateForNode =
        activeNodeDragState && activeNodeDragState.nodeId === node.id
          ? activeNodeDragState
          : null;
      const targetPosition = resolveNodeRenderTargetPosition(
        node,
        dragStateForNode,
        nodeCardDraftPositionsRef.current.get(node.id)
      );
      const targetWidth = dimensions.width;
      const targetHeight = dimensions.height;
      const fromTransitionState = activeProjectionTransition?.fromNodes.get(node.id);
      const toTransitionState = activeProjectionTransition?.toNodes.get(node.id);
      const startTransitionState = dragStateForNode
        ? null
        : fromTransitionState ?? toTransitionState;
      const endTransitionState = toTransitionState ?? {
        position: targetPosition,
        width: targetWidth,
        height: targetHeight,
      };
      const interpolatedPosition = startTransitionState
        ? {
          x: startTransitionState.position.x +
            (endTransitionState.position.x - startTransitionState.position.x) * projectionTransitionEasedProgress,
          y: startTransitionState.position.y +
            (endTransitionState.position.y - startTransitionState.position.y) * projectionTransitionEasedProgress,
        }
        : targetPosition;
      const width = startTransitionState
        ? Math.max(
          dimensions.minWidth,
          snapToPixel(
            startTransitionState.width +
              (endTransitionState.width - startTransitionState.width) * projectionTransitionEasedProgress
          )
        )
        : targetWidth;
      const height = startTransitionState
        ? Math.max(
          dimensions.minHeight,
          snapToPixel(
            startTransitionState.height +
              (endTransitionState.height - startTransitionState.height) * projectionTransitionEasedProgress
          )
        )
        : targetHeight;
      const graphicsOutput = nodeGraphicsOutputsRef.current[node.id];
      const hasGraphicsOutput = Boolean(graphicsOutput);
      const shouldProjectGraphics = isRenderablePythonGraphicsOutput(node, graphicsOutput);
      let projectedWidthOnScreen: number | null = null;
      let estimatedMaxPixels: number | null = null;
      let stableMaxPixels: number | null = null;
      let selectedLevel: number | null = null;
      let selectedLevelPixels: number | null = null;
      if (shouldProjectGraphics && graphicsOutput) {
        projectedWidthOnScreen = width * viewportScale;
        estimatedMaxPixels = estimateProjectedPixelBudget(
          graphicsOutput,
          projectedWidthOnScreen,
          PIXEL_RATIO
        );
        stableMaxPixels = resolveStableGraphicsRequestMaxPixels(
          graphicsOutput,
          estimatedMaxPixels
        );

        const matchedLevel = graphicsOutput.levels.find(
          (level) => level.pixelCount === stableMaxPixels
        );
        if (matchedLevel) {
          selectedLevel = matchedLevel.level;
          selectedLevelPixels = matchedLevel.pixelCount;
        }
      }
      const expectedProjectedGraphicsHeight =
        shouldProjectGraphics && graphicsOutput
          ? Math.max(1, width * resolveGraphicsAspectRatio(graphicsOutput))
          : 0;
      const position = {
        x: snapToPixel(interpolatedPosition.x),
        y: snapToPixel(interpolatedPosition.y),
      };
      if (node.type === NodeType.ANNOTATION) {
        const annotationConfig = normalizeAnnotationConfig(
          node.config.config as Record<string, unknown> | undefined
        );
        if (annotationConfig.text.length > 0) {
          nextAnnotationOverlays.push({
            nodeId: node.id,
            x: position.x + ANNOTATION_TEXT_INSET_X,
            y: position.y + ANNOTATION_TEXT_INSET_Y,
            width: Math.max(32, width - (ANNOTATION_TEXT_INSET_X * 2)),
            height: Math.max(24, height - ANNOTATION_TEXT_INSET_Y - ANNOTATION_TEXT_INSET_BOTTOM),
            text: annotationConfig.text,
            backgroundColor: annotationConfig.backgroundColor,
            fontColor: annotationConfig.fontColor,
            fontSize: annotationConfig.fontSize,
          });
        }
      }
      const graphicsBounds: WorldBounds | null =
        shouldProjectGraphics && expectedProjectedGraphicsHeight > 0
          ? {
            minX: position.x,
            minY: position.y + height,
              maxX: position.x + width,
              maxY: position.y + height + expectedProjectedGraphicsHeight,
            }
          : null;
      const shouldLoadProjectedGraphicsByViewport =
        Boolean(
          shouldProjectGraphics &&
            graphicsOutput &&
            canEvaluateViewportGraphics &&
            viewportWorldBounds &&
            graphicsBounds &&
            worldBoundsIntersect(viewportWorldBounds, graphicsBounds)
        );
      const canReloadProjectedGraphics = !isProjectionTransitionActive;
      const shouldLoadProjectedGraphics = shouldLoadProjectedGraphicsByViewport && canReloadProjectedGraphics;
      let requestUrl: string | null = null;
      const container = new Container();
      const isSelected = selectedNodeId === node.id;

      container.position.set(snapToPixel(position.x), snapToPixel(position.y));
      container.eventMode = 'static';
      container.cursor = 'pointer';
      // Keep the card body selectable even when fill alpha is 0 (fully transparent).
      const hitPadding = NODE_RESIZE_HANDLE_SIZE * 0.5;
      container.hitArea = new Rectangle(
        -hitPadding,
        -hitPadding,
        width + (hitPadding * 2),
        height + (hitPadding * 2)
      );

      let projectedGraphicsHeight = expectedProjectedGraphicsHeight;
      let projectedGraphicsTexture: Texture | null = null;
      if (shouldProjectGraphics && graphicsOutput) {
        if (shouldLoadProjectedGraphics) {
          const source = buildGraphicsImageUrl(
            graphicsOutput,
            stableMaxPixels ?? undefined
          );
          requestUrl = source;
          projectedGraphicsTexture = getNodeGraphicsTextureForNode(node.id, source);
          activeNodeGraphicsTextureIds.add(node.id);
        } else if (isProjectionTransitionActive) {
          const boundSource = nodeGraphicsTextureBindingsRef.current.get(node.id);
          if (boundSource) {
            const cachedTexture = graphicsTextureCacheRef.current.get(boundSource)?.texture;
            if (cachedTexture) {
              projectedGraphicsTexture = cachedTexture;
              activeNodeGraphicsTextureIds.add(node.id);
            }
          }
        }

        if (projectedGraphicsTexture) {
          const textureDimensions = getTextureDimensions(projectedGraphicsTexture);
          const resolvedTextureWidth = textureDimensions.width;
          const resolvedTextureHeight = textureDimensions.height;
          const resolvedTextureValid = textureDimensions.valid;
          projectedGraphicsHeight = resolvedTextureValid
            ? (width * resolvedTextureHeight) / resolvedTextureWidth
            : width * NODE_GRAPHICS_FALLBACK_ASPECT_RATIO;
        }
      }

      if (node.id === selectedNodeIdValue) {
        selectedNodeGraphicsDebugNext = {
          nodeId: node.id,
          nodeType: node.type,
          hasGraphicsOutput,
          isRenderableGraphics: shouldProjectGraphics,
          graphicsId: graphicsOutput?.id ?? null,
          mimeType: graphicsOutput?.mimeType ?? null,
          levelCount: graphicsOutput?.levels.length ?? 0,
          levelPixels: graphicsOutput?.levels.map((level) => level.pixelCount) ?? [],
          viewportScale,
          projectionWidth: shouldProjectGraphics ? width : null,
          projectedWidthOnScreen,
          devicePixelRatio: PIXEL_RATIO,
          estimatedMaxPixels,
          stableMaxPixels,
          selectedLevel,
          selectedLevelPixels,
          shouldLoadProjectedGraphicsByViewport,
          canReloadProjectedGraphics,
          shouldLoadProjectedGraphics,
          requestUrl,
        };
      }
      const hasProjectedGraphics = shouldProjectGraphics && (
        Boolean(projectedGraphicsTexture) ||
        (shouldLoadProjectedGraphics && Boolean(graphicsOutput))
      );
      const annotationConfig = node.type === NodeType.ANNOTATION
        ? normalizeAnnotationConfig(node.config.config as Record<string, unknown> | undefined)
        : null;
      const annotationBackground = annotationConfig
        ? colorStringToPixi(annotationConfig.backgroundColor, '#fef3c7')
        : null;
      const annotationBorder = annotationConfig
        ? colorStringToPixi(annotationConfig.borderColor, '#334155')
        : null;

      const frame = new Graphics();
      drawNodeCardFrame(
        frame,
        width,
        height,
        annotationBorder
          ? annotationBorder.color
          : isSelected
            ? 0x1d4ed8
            : 0x334155,
        annotationBackground
          ? annotationBackground.color
          : isSelected
            ? 0xe2e8f0
            : 0xf8fafc,
        hasProjectedGraphics,
        annotationBorder?.alpha ?? 1,
        annotationBackground?.alpha ?? 1,
        !annotationConfig
      );
      frame.eventMode = 'static';
      frame.hitArea = new Rectangle(0, 0, width, height);
      container.addChild(frame);

      const nodeExecutionState = nodeExecutionStatesRef.current[node.id];
      const autoRecomputeEnabled = Boolean(node.config.config?.autoRecompute);
      const statusLightColor = nodeExecutionState?.hasError
        ? 0xef4444
        : (nodeExecutionState?.isPending || nodeExecutionState?.isComputing)
          ? 0xf59e0b
          : nodeExecutionState?.isStale
            ? 0x8b5a2b
          : autoRecomputeEnabled
            ? 0x22c55e
            : 0x94a3b8;
      if (!annotationConfig) {
        const statusLight = new Graphics();
        statusLight.lineStyle(1, 0x0f172a, 0.25);
        statusLight.beginFill(statusLightColor, 1);
        statusLight.drawCircle(width - 13, 12, 5);
        statusLight.endFill();
        container.addChild(statusLight);
      }

      if (!annotationConfig) {
        const titleText = truncateTextToWidth(
          node.metadata.name,
          width - 34,
          (candidate) => candidate.length * NODE_TITLE_CHAR_WIDTH_ESTIMATE
        );
        const title = new Text(titleText, NODE_TITLE_TEXT_STYLE);
        title.resolution = PIXEL_RATIO;
        textNodesRef.current.add(title);
        title.position.set(12, 8);
        container.addChild(title);
      }

      if (node.type !== NodeType.NUMERIC_INPUT && node.type !== NodeType.ANNOTATION) {
        const subtitle = new Text(node.type.replace(/_/g, ' '), {
          fontFamily: 'Arial',
          fontSize: 11,
          fill: 0x475569,
        });
        subtitle.resolution = PIXEL_RATIO;
        textNodesRef.current.add(subtitle);
        subtitle.position.set(12, 22);
        container.addChild(subtitle);
      }

      const inputPortOffsets = new Map<string, number>();
      const outputPortOffsets = new Map<string, number>();
      const bodyHeight = Math.max(1, height - HEADER_HEIGHT - NODE_BODY_PADDING);
      const inputSlots = Math.max(node.metadata.inputs.length, 1);
      const outputSlots = Math.max(node.metadata.outputs.length, 1);
      const numericSliderY = height - NUMERIC_SLIDER_Y_OFFSET;
      const isNumericInputNode = node.type === NodeType.NUMERIC_INPUT;

      for (let i = 0; i < node.metadata.inputs.length; i += 1) {
        const port = node.metadata.inputs[i];
        const portKey = makePortKey(node.id, port.name);
        const y = HEADER_HEIGHT + ((i + 1) * bodyHeight) / (inputSlots + 1);
        inputPortOffsets.set(port.name, y);

        const marker = new Graphics();
        drawInputPortMarker(marker, false);
        marker.eventMode = 'static';
        marker.cursor = 'crosshair';
        marker.hitArea = new Circle(0, 0, PORT_RADIUS + 8);
        marker.position.set(0, y);
        marker.on('pointerover', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          hoveredInputPortKeyRef.current = portKey;
          drawInputPortMarker(marker, true);
          const dragState = connectionDragStateRef.current;
          if (dragState) {
            dragState.hoveredInputKey = portKey;
            drawConnections();
          }
        });
        marker.on('pointerout', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          if (hoveredInputPortKeyRef.current === portKey) {
            hoveredInputPortKeyRef.current = null;
          }
          drawInputPortMarker(marker, false);
          const dragState = connectionDragStateRef.current;
          if (dragState && dragState.hoveredInputKey === portKey) {
            dragState.hoveredInputKey = null;
            drawConnections();
          }
        });
        container.addChild(marker);
        inputPortMarkersRef.current.set(portKey, marker);
        inputPortPositionsRef.current.set(portKey, {
          x: position.x,
          y: position.y + y,
        });

        const label = new Text(port.name, {
          fontFamily: 'Arial',
          fontSize: 10,
          fill: 0x1e293b,
        });
        label.resolution = PIXEL_RATIO;
        textNodesRef.current.add(label);
        label.position.set(10, y - 7);
        container.addChild(label);
      }

      for (let i = 0; i < node.metadata.outputs.length; i += 1) {
        const port = node.metadata.outputs[i];
        const portKey = makePortKey(node.id, port.name);
        const y = isNumericInputNode
          ? numericSliderY
          : HEADER_HEIGHT + ((i + 1) * bodyHeight) / (outputSlots + 1);
        outputPortOffsets.set(port.name, y);

        const marker = new Graphics();
        drawOutputPortMarker(marker, false);
        marker.eventMode = 'static';
        marker.cursor = 'crosshair';
        marker.hitArea = new Circle(0, 0, PORT_RADIUS + 8);
        marker.position.set(width, y);
        marker.on('pointerover', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          hoveredOutputPortKeyRef.current = portKey;
          drawOutputPortMarker(marker, true);
        });
        marker.on('pointerout', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          requestCanvasAnimationLoop();
          if (hoveredOutputPortKeyRef.current === portKey) {
            hoveredOutputPortKeyRef.current = null;
          }
          if (connectionDragStateRef.current?.sourcePortKey !== portKey) {
            drawOutputPortMarker(marker, false);
          }
        });
        marker.on('pointerdown', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          if (event.button !== 0) return;
          event.stopPropagation();
          const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
          canvas?.focus({ preventScroll: true });

          const sourcePosition = nodePositionsRef.current.get(node.id) ?? node.position;
          connectionDragStateRef.current = {
            sourceNodeId: node.id,
            sourcePort: port.name,
            sourcePortKey: portKey,
            startX: sourcePosition.x + width,
            startY: sourcePosition.y + y,
            pointerX: event.global.x,
            pointerY: event.global.y,
            hoveredInputKey: null,
          };
          drawOutputPortMarker(marker, true);
          selectedNodeIdRef.current = node.id;
          selectNode(node.id);
          drawConnections();
        });
        container.addChild(marker);
        outputPortMarkersRef.current.set(portKey, marker);
        outputPortPositionsRef.current.set(portKey, {
          x: position.x + width,
          y: position.y + y,
        });

        if (!isNumericInputNode) {
          const label = new Text(port.name, {
            fontFamily: 'Arial',
            fontSize: 10,
            fill: 0x1e293b,
          });
          label.resolution = PIXEL_RATIO;
          textNodesRef.current.add(label);
          label.anchor.set(1, 0);
          label.position.set(width - 10, y - 7);
          container.addChild(label);
        }
      }

      if (isNumericInputNode) {
        const activeNumericSliderDragState = numericSliderDragStateRef.current;
        const numericSliderDragStateForNode =
          activeNumericSliderDragState && activeNumericSliderDragState.nodeId === node.id
            ? activeNumericSliderDragState
            : null;
        const numericConfigBase = normalizeNumericInputConfig(
          node.config.config as Record<string, unknown> | undefined
        );
        const numericConfig = numericSliderDragStateForNode
          ? {
            ...numericConfigBase,
            // Preserve live drag value if the canvas re-renders before pointerup commits it.
            value: snapNumericInputValue(
              numericSliderDragStateForNode.currentValue,
              numericConfigBase.min,
              numericConfigBase.max,
              numericConfigBase.step
            ),
          }
          : numericConfigBase;
        const trackX = NUMERIC_SLIDER_LEFT_PADDING;
        const trackWidth = Math.max(
          40,
          width - NUMERIC_SLIDER_LEFT_PADDING - NUMERIC_SLIDER_RIGHT_PADDING
        );
        const trackY = numericSliderY;

        const track = new Graphics();
        track.eventMode = 'none';
        container.addChild(track);

        const knob = new Graphics();
        knob.eventMode = 'none';
        container.addChild(knob);

        const valueLabel = new Text(formatNumericInputValue(numericConfig.value, numericConfig.step), {
          fontFamily: 'Arial',
          fontSize: 11,
          fontWeight: 'bold',
          fill: 0x1e3a8a,
        });
        valueLabel.resolution = PIXEL_RATIO;
        textNodesRef.current.add(valueLabel);
        valueLabel.anchor.set(0, 0.5);
        valueLabel.position.set(trackX + trackWidth + 8, trackY);
        container.addChild(valueLabel);

        const sliderHitArea = new Graphics();
        sliderHitArea.beginFill(0x000000, 0.001);
        // Cover the full slider row to avoid parent-card cursor precedence at slider edges.
        sliderHitArea.drawRoundedRect(
          0,
          trackY - 14,
          width,
          28,
          10
        );
        sliderHitArea.endFill();
        sliderHitArea.eventMode = 'static';
        sliderHitArea.cursor = 'ew-resize';
        sliderHitArea.on('pointerover', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          hoveredNumericSliderNodeIdRef.current = node.id;
          applyCanvasCursor();
        });
        sliderHitArea.on('pointermove', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          if (numericSliderDragStateRef.current?.nodeId === node.id) {
            requestCanvasAnimationLoop();
            updateNumericSliderFromPointer(node.id, event.global.x, event.global.y);
          }
          hoveredNumericSliderNodeIdRef.current = node.id;
          applyCanvasCursor();
        });
        sliderHitArea.on('pointerout', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          event.stopPropagation();
          if (numericSliderDragStateRef.current?.nodeId === node.id) {
            return;
          }
          if (hoveredNumericSliderNodeIdRef.current === node.id) {
            hoveredNumericSliderNodeIdRef.current = null;
          }
          applyCanvasCursor();
        });

        const slider: NumericSliderVisual = {
          nodeId: node.id,
          nodeContainer: container,
          track,
          knob,
          valueLabel,
          trackX,
          trackY,
          trackWidth,
          min: numericConfig.min,
          max: numericConfig.max,
          step: numericConfig.step,
          value: numericConfig.value,
        };
        drawNumericSliderVisual(slider);
        numericSliderVisualsRef.current.set(node.id, slider);

        sliderHitArea.on('pointerdown', (event: FederatedPointerEvent) => {
          if (drawingEnabledRef.current) {
            return;
          }
          if (event.button !== 0) {
            return;
          }
          event.stopPropagation();
          const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
          canvas?.focus({ preventScroll: true });

          requestCanvasAnimationLoop();
          selectedConnectionIdRef.current = null;
          selectedNodeIdRef.current = node.id;
          selectNode(node.id);

          numericSliderDragStateRef.current = {
            nodeId: node.id,
            initialValue: slider.value,
            currentValue: slider.value,
          };
          hoveredNumericSliderNodeIdRef.current = node.id;
          applyCanvasCursor();
          updateNumericSliderFromPointer(node.id, event.global.x, event.global.y);
        });
        container.addChild(sliderHitArea);
      }

      if (isSelected) {
        const currentPosition = nodePositionsRef.current.get(node.id) ?? node.position;
        const handleSize = NODE_RESIZE_HANDLE_SIZE;
        const createResizeHandle = (
          handleX: number,
          handleY: number,
          handleDirection: ResizeHandleDirection
        ) => {
          const resizeHandle = new Graphics();
          resizeHandle.lineStyle(1, 0x1e3a8a, 0.7);
          resizeHandle.beginFill(0x1d4ed8, 0.9);
          resizeHandle.drawRoundedRect(handleX, handleY, handleSize, handleSize, 2);
          resizeHandle.endFill();
          resizeHandle.eventMode = 'static';
          resizeHandle.cursor = resolveResizeCursor(handleDirection);
          resizeHandle.on('pointerover', (event: FederatedPointerEvent) => {
            if (drawingEnabledRef.current) {
              return;
            }
            event.stopPropagation();
            hoveredNodeResizeHandleRef.current = { nodeId: node.id, handle: handleDirection };
            applyCanvasCursor();
          });
          resizeHandle.on('pointerout', (event: FederatedPointerEvent) => {
            if (drawingEnabledRef.current) {
              return;
            }
            event.stopPropagation();
            if (
              nodeResizeStateRef.current?.nodeId === node.id &&
              nodeResizeStateRef.current.handle === handleDirection
            ) {
              return;
            }
            if (
              hoveredNodeResizeHandleRef.current?.nodeId === node.id &&
              hoveredNodeResizeHandleRef.current.handle === handleDirection
            ) {
              hoveredNodeResizeHandleRef.current = null;
            }
            applyCanvasCursor();
          });
          resizeHandle.on('pointerdown', (event: FederatedPointerEvent) => {
            if (drawingEnabledRef.current) {
              return;
            }
            if (event.button !== 0) return;
            event.stopPropagation();
            const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
            canvas?.focus({ preventScroll: true });

            selectedConnectionIdRef.current = null;
            selectedNodeIdRef.current = node.id;
            selectNode(node.id);
            nodeResizeStateRef.current = {
              nodeId: node.id,
              pointerX: event.global.x,
              pointerY: event.global.y,
              x: currentPosition.x,
              y: currentPosition.y,
              width,
              height,
              handle: handleDirection,
              minWidth: dimensions.minWidth,
              minHeight: dimensions.minHeight,
              currentX: currentPosition.x,
              currentY: currentPosition.y,
              currentWidth: width,
              currentHeight: height,
            };
            nodeCardDraftSizesRef.current.set(node.id, { width, height });
            nodeCardDraftPositionsRef.current.set(node.id, { x: currentPosition.x, y: currentPosition.y });
            hoveredNodeResizeHandleRef.current = { nodeId: node.id, handle: handleDirection };
            requestCanvasAnimationLoop();
            applyCanvasCursor();
          });
          resizeHandle.on('pointertap', (event: FederatedPointerEvent) => {
            event.stopPropagation();
          });
          container.addChild(resizeHandle);
        };

        if (node.type === NodeType.ANNOTATION) {
          const edgeOffset = handleSize * 0.5;
          createResizeHandle(-edgeOffset, -edgeOffset, 'nw');
          createResizeHandle((width * 0.5) - edgeOffset, -edgeOffset, 'n');
          createResizeHandle(width - edgeOffset, -edgeOffset, 'ne');
          createResizeHandle(width - edgeOffset, (height * 0.5) - edgeOffset, 'e');
          createResizeHandle(width - edgeOffset, height - edgeOffset, 'se');
          createResizeHandle((width * 0.5) - edgeOffset, height - edgeOffset, 's');
          createResizeHandle(-edgeOffset, height - edgeOffset, 'sw');
          createResizeHandle(-edgeOffset, (height * 0.5) - edgeOffset, 'w');
        } else {
          const handleX = width - handleSize - NODE_RESIZE_HANDLE_MARGIN;
          const handleY = height - handleSize - NODE_RESIZE_HANDLE_MARGIN;
          createResizeHandle(handleX, handleY, 'se');
        }
      }

      if (projectedGraphicsTexture) {
        const textureDimensions = getTextureDimensions(projectedGraphicsTexture);
        const resolvedTextureWidth = textureDimensions.width;
        const resolvedTextureValid = textureDimensions.valid;
        if (resolvedTextureValid) {
          const imageSprite = new Sprite(projectedGraphicsTexture);
          imageSprite.eventMode = 'none';
          const scale = width / resolvedTextureWidth;
          imageSprite.scale.set(scale);
          imageSprite.position.set(0, height);
          container.addChild(imageSprite);
        }
      }

      container.on('pointerdown', (event: FederatedPointerEvent) => {
        if (drawingEnabledRef.current) {
          return;
        }
        if (event.button !== 0) return;
        event.stopPropagation();
        const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
        canvas?.focus({ preventScroll: true });

        const currentPosition = nodePositionsRef.current.get(node.id) ?? {
          x: node.position.x,
          y: node.position.y,
        };

        nodeDragStateRef.current = {
          nodeId: node.id,
          pointerX: event.global.x,
          pointerY: event.global.y,
          nodeX: currentPosition.x,
          nodeY: currentPosition.y,
          currentX: currentPosition.x,
          currentY: currentPosition.y,
          moved: false,
        };
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = node.id;
        selectNode(node.id);
      });

      container.on('pointertap', (event: FederatedPointerEvent) => {
        if (drawingEnabledRef.current) {
          return;
        }
        const dragState = nodeDragStateRef.current;
        if (dragState?.nodeId === node.id && dragState.moved) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = node.id;
        selectNode(node.id);
      });

      nodesLayer.addChild(container);
      nodePositionsRef.current.set(node.id, position);
      nodeVisualsRef.current.set(node.id, {
        node,
        container,
        width,
        height,
        projectedGraphicsHeight,
        inputPortOffsets,
        outputPortOffsets,
      });
      syncNodePortPositions(node.id, position, {
        node,
        container,
        width,
        height,
        projectedGraphicsHeight,
        inputPortOffsets,
        outputPortOffsets,
      });
    }

    if (!isProjectionTransitionActive) {
      releaseUnusedNodeGraphicsTextures(activeNodeGraphicsTextureIds);
    }

    for (const drawing of currentGraph.drawings ?? []) {
      const position = { ...drawing.position };
      const container = new Container();
      const isSelected = selectedDrawingId === drawing.id;
      const width = Math.max(96, Math.min(220, drawing.name.length * 7 + 30));
      const height = 24;

      container.position.set(snapToPixel(position.x), snapToPixel(position.y));
      container.eventMode = 'static';
      container.cursor = 'move';

      const frame = new Graphics();
      frame.lineStyle(2, isSelected ? 0x0ea5e9 : 0x334155, 1);
      frame.beginFill(isSelected ? 0xdbeafe : 0xe2e8f0, 0.95);
      frame.drawRoundedRect(0, 0, width, height, 8);
      frame.endFill();
      container.addChild(frame);

      const title = new Text(drawing.name, {
        fontFamily: 'Arial',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0x0f172a,
      });
      title.resolution = PIXEL_RATIO;
      textNodesRef.current.add(title);
      title.position.set(10, 5);
      container.addChild(title);

      container.on('pointerdown', (event: FederatedPointerEvent) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const canvas = appRef.current?.view as HTMLCanvasElement | undefined;
        canvas?.focus({ preventScroll: true });

        const currentPosition = drawingPositionsRef.current.get(drawing.id) ?? drawing.position;
        drawingDragStateRef.current = {
          drawingId: drawing.id,
          pointerX: event.global.x,
          pointerY: event.global.y,
          drawingX: currentPosition.x,
          drawingY: currentPosition.y,
          currentX: currentPosition.x,
          currentY: currentPosition.y,
          moved: false,
        };
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = null;
        selectedDrawingIdRef.current = drawing.id;
        selectDrawing(drawing.id);
      });

      container.on('pointertap', (event: FederatedPointerEvent) => {
        const dragState = drawingDragStateRef.current;
        if (dragState?.drawingId === drawing.id && dragState.moved) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        selectedConnectionIdRef.current = null;
        selectedNodeIdRef.current = null;
        selectedDrawingIdRef.current = drawing.id;
        selectDrawing(drawing.id);
      });

      drawingHandleLayer.addChild(container);
      drawingPositionsRef.current.set(drawing.id, position);
      drawingVisualsRef.current.set(drawing.id, {
        drawing,
        container,
        width,
        height,
      });
    }

    if (!areAnnotationOverlaysEqual(annotationOverlaysRef.current, nextAnnotationOverlays)) {
      annotationOverlaysRef.current = nextAnnotationOverlays;
      setAnnotationOverlays(nextAnnotationOverlays);
    }

    drawConnections();
    drawFreehandStrokes();

    if (!viewportInitializedRef.current) {
      fitViewportToGraph();
      viewportInitializedRef.current = true;
    }
    const viewport = viewportRef.current;
    if (viewport) {
      updateTextResolutionForScale(viewport.scale.x);
    }
    drawMinimap();
    if (!areNodeGraphicsDebugValuesEqual(selectedNodeGraphicsDebugRef.current, selectedNodeGraphicsDebugNext)) {
      selectedNodeGraphicsDebugRef.current = selectedNodeGraphicsDebugNext;
      setSelectedNodeGraphicsDebug(selectedNodeGraphicsDebugNext);
    }
    if (isProjectionTransitionActive) {
      requestViewportDrivenGraphRefresh();
    }
  }, [
    applyCanvasCursor,
    clearAllNodeGraphicsTextures,
    drawConnections,
    drawFreehandStrokes,
    drawMinimap,
    fitViewportToGraph,
    getNodeGraphicsTextureForNode,
    releaseUnusedNodeGraphicsTextures,
    refreshCanvasBackgroundTexture,
    requestCanvasAnimationLoop,
    requestViewportDrivenGraphRefresh,
    setSelectedNodeGraphicsDebug,
    selectDrawing,
    selectNode,
    selectedDrawingId,
    selectedNodeId,
    syncNodePortPositions,
    updateNumericSliderFromPointer,
    updateTextResolutionForScale,
  ]);

  useEffect(() => {
    renderGraphRef.current = renderGraph;
  }, [renderGraph]);

  useEffect(() => {
    const previousGraph = graphRef.current;
    const shouldAnimateProjectionSwitch = Boolean(
      previousGraph &&
      graph &&
      previousGraph.id === graph.id &&
      previousGraph.activeProjectionId &&
      graph.activeProjectionId &&
      previousGraph.activeProjectionId !== graph.activeProjectionId
    );
    if (shouldAnimateProjectionSwitch) {
      startProjectionTransition(previousGraph, graph);
    }

    graphRef.current = graph;

    const nextGraphId = graph?.id ?? null;
    if (lastGraphIdRef.current !== nextGraphId) {
      lastGraphIdRef.current = nextGraphId;
      viewportInitializedRef.current = false;
      projectionTransitionRef.current = null;
    }

    if (
      selectedConnectionIdRef.current &&
      !graph?.connections.some((connection) => connection.id === selectedConnectionIdRef.current)
    ) {
      selectedConnectionIdRef.current = null;
    }

    if (
      selectedDrawingIdRef.current &&
      !graph?.drawings?.some((drawing) => drawing.id === selectedDrawingIdRef.current)
    ) {
      selectedDrawingIdRef.current = null;
      selectDrawing(null);
    }

    renderGraphRef.current();
  }, [graph, renderGraph, selectDrawing, startProjectionTransition]);

  useEffect(() => {
    if (drawingCreateRequestId <= handledDrawingCreateRequestRef.current) {
      return;
    }

    if (!canvasReady) {
      return;
    }

    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;
    if (!app || !viewport || !currentGraph) {
      return;
    }

    const worldPoint = viewport.toLocal(new Point(app.screen.width / 2, app.screen.height / 2));
    const drawing: GraphDrawing = {
      id: uuidv4(),
      name: getNextDrawingName(currentGraph.drawings ?? []),
      position: {
        x: snapToPixel(worldPoint.x),
        y: snapToPixel(worldPoint.y),
      },
      paths: [],
    };

    handledDrawingCreateRequestRef.current = drawingCreateRequestId;
    addDrawing(drawing);
    selectDrawing(drawing.id);
  }, [addDrawing, canvasReady, drawingCreateRequestId, selectDrawing, graph]);

  useEffect(() => {
    renderGraphRef.current();
  }, [selectedDrawingId, selectedNodeId, renderGraph]);

  useEffect(() => {
    const app = appRef.current;
    if (!app) {
      return;
    }

    if (drawingEnabled) {
      panStateRef.current = null;
      nodeDragStateRef.current = null;
      nodeResizeStateRef.current = null;
      hoveredNodeResizeHandleRef.current = null;
      nodeCardDraftSizesRef.current.clear();
      nodeCardDraftPositionsRef.current.clear();
      numericSliderDragStateRef.current = null;
      hoveredNumericSliderNodeIdRef.current = null;
      drawingDragStateRef.current = null;
      if (connectionDragStateRef.current) {
        endConnectionDrag(false);
      }
    }

    drawFreehandStrokes();
    renderGraphRef.current();
    applyCanvasCursor();
  }, [applyCanvasCursor, drawingEnabled, drawFreehandStrokes, endConnectionDrag]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    settings.ROUND_PIXELS = true;

    const app = new Application({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: PIXEL_RATIO,
      resizeTo: host,
    });

    appRef.current = app;
    setCanvasReady(true);
    host.appendChild(app.view as HTMLCanvasElement);

    const viewport = new Container();
    const edgeLayer = new Graphics();
    const nodeLayer = new Container();
    const drawingHandleLayer = new Container();
    const drawLayer = new Graphics();
    drawLayer.eventMode = 'none';
    drawingHandleLayer.eventMode = 'passive';
    const effectsLayer = new Graphics();
    effectsLayer.eventMode = 'none';
    const backgroundSprite = new Sprite(Texture.WHITE);
    backgroundSpriteRef.current = backgroundSprite;
    backgroundSprite.position.set(0, 0);
    backgroundSprite.width = app.screen.width;
    backgroundSprite.height = app.screen.height;
    backgroundSprite.eventMode = 'none';

    viewportRef.current = viewport;
    edgeLayerRef.current = edgeLayer;
    nodeLayerRef.current = nodeLayer;
    drawingHandleLayerRef.current = drawingHandleLayer;
    drawLayerRef.current = drawLayer;
    effectsLayerRef.current = effectsLayer;
    app.stage.addChild(backgroundSprite);
    viewport.addChild(edgeLayer);
    viewport.addChild(nodeLayer);
    viewport.addChild(drawLayer);
    viewport.addChild(drawingHandleLayer);
    viewport.addChild(effectsLayer);
    app.stage.addChild(viewport);

    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);

    const canvasElement = app.view as HTMLCanvasElement;
    canvasElement.style.display = 'block';
    canvasElement.style.width = '100%';
    canvasElement.style.height = '100%';
    canvasElement.style.touchAction = 'none';
    canvasElement.tabIndex = 0;
    canvasElement.style.outline = 'none';
    applyCanvasCursor();
    refreshCanvasBackgroundTexture();

    const finishInteraction = () => {
      if (connectionDragStateRef.current) {
        endConnectionDrag(true);
      }

      const numericSliderDragState = numericSliderDragStateRef.current;
      if (numericSliderDragState) {
        if (Math.abs(numericSliderDragState.currentValue - numericSliderDragState.initialValue) > 1e-9) {
          commitNumericSliderValue(numericSliderDragState.nodeId, numericSliderDragState.currentValue);
        }
        numericSliderDragStateRef.current = null;
      }

      const activeDrawingPath = activeDrawingPathRef.current;
      if (activeDrawingPath) {
        const normalizedPoints = activeDrawingPath.path.points
          .filter((point, index, points) =>
            index === 0 || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) >= 0.2
          );
        if (normalizedPoints.length > 0) {
          addDrawingPath(activeDrawingPath.drawingId, {
            ...activeDrawingPath.path,
            points: normalizedPoints,
          });
        }
        activeDrawingPathRef.current = null;
        drawFreehandStrokes();
      }

      const dragState = nodeDragStateRef.current;
      if (dragState) {
        if (dragState.moved) {
          updateNodePosition(dragState.nodeId, {
            x: dragState.currentX,
            y: dragState.currentY,
          });
        }
        nodeDragStateRef.current = null;
      }

      const resizeState = nodeResizeStateRef.current;
      if (resizeState) {
        const positionChanged = (
          Math.abs(resizeState.currentX - resizeState.x) > 0.5 ||
          Math.abs(resizeState.currentY - resizeState.y) > 0.5
        );
        const sizeChanged = (
          Math.abs(resizeState.currentWidth - resizeState.width) > 0.5 ||
          Math.abs(resizeState.currentHeight - resizeState.height) > 0.5
        );
        const currentGraph = graphRef.current;
        if ((positionChanged || sizeChanged) && currentGraph) {
          const activeProjectionId = currentGraph.activeProjectionId ?? DEFAULT_GRAPH_PROJECTION_ID;
          const nextPosition = {
            x: resizeState.currentX,
            y: resizeState.currentY,
          };
          const nextCardSize = {
            width: resizeState.currentWidth,
            height: resizeState.currentHeight,
          };
          const nextNodes = currentGraph.nodes.map((node) => {
            if (node.id !== resizeState.nodeId) {
              return node;
            }
            return {
              ...node,
              position: nextPosition,
              config: {
                ...node.config,
                config: {
                  ...(node.config.config ?? {}),
                  cardWidth: nextCardSize.width,
                  cardHeight: nextCardSize.height,
                },
              },
            };
          });
          const nextProjections = (currentGraph.projections ?? []).map((projection) =>
            projection.id === activeProjectionId
              ? withNodeCardSizeInProjection(
                withNodePositionInProjection(projection, resizeState.nodeId, nextPosition),
                resizeState.nodeId,
                nextCardSize
              )
              : projection
          );

          void updateGraph({
            ...currentGraph,
            nodes: nextNodes,
            projections: nextProjections,
            updatedAt: Date.now(),
          });
        }
        nodeCardDraftSizesRef.current.delete(resizeState.nodeId);
        nodeCardDraftPositionsRef.current.delete(resizeState.nodeId);
        if (hoveredNodeResizeHandleRef.current?.nodeId === resizeState.nodeId) {
          hoveredNodeResizeHandleRef.current = null;
        }
        nodeResizeStateRef.current = null;
      }

      const drawingDragState = drawingDragStateRef.current;
      if (drawingDragState) {
        if (drawingDragState.moved) {
          updateDrawingPosition(drawingDragState.drawingId, {
            x: drawingDragState.currentX,
            y: drawingDragState.currentY,
          });
        }
        drawingDragStateRef.current = null;
      }

      panStateRef.current = null;
      applyCanvasCursor();
    };

    const handleStagePointerDown = (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      canvasElement.focus({ preventScroll: true });

      if (drawingEnabledRef.current) {
        const drawingId = selectedDrawingIdRef.current;
        if (!drawingId) {
          return;
        }
        const worldPoint = viewport.toLocal(new Point(event.global.x, event.global.y));
        const drawingPosition =
          drawingPositionsRef.current.get(drawingId) ??
          graphRef.current?.drawings?.find((drawing) => drawing.id === drawingId)?.position;

        if (!drawingPosition) {
          return;
        }

        activeDrawingPathRef.current = {
          drawingId,
          path: {
            id: uuidv4(),
            color: drawingColorRef.current,
            thickness: drawingThicknessRef.current,
            points: [
              {
                x: worldPoint.x - drawingPosition.x,
                y: worldPoint.y - drawingPosition.y,
              },
            ],
          },
        };
        drawFreehandStrokes();
        return;
      }

      // Only treat direct stage clicks as empty-canvas interactions.
      if (event.target !== app.stage) {
        return;
      }

      const pickedConnectionId = pickConnectionAtClientPoint(event.clientX, event.clientY);
      if (pickedConnectionId) {
        selectedConnectionIdRef.current = pickedConnectionId;
        selectedNodeIdRef.current = null;
        selectNode(null);
        drawConnections();
        return;
      }

      panStateRef.current = {
        pointerX: event.global.x,
        pointerY: event.global.y,
        viewportX: viewport.position.x,
        viewportY: viewport.position.y,
      };
      applyCanvasCursor();
      if (selectedConnectionIdRef.current) {
        selectedConnectionIdRef.current = null;
        drawConnections();
      }
      if (selectedDrawingIdRef.current) {
        selectedDrawingIdRef.current = null;
        selectDrawing(null);
      }
      selectedNodeIdRef.current = null;
      selectNode(null);
    };

    const handleStagePointerMove = (event: FederatedPointerEvent) => {
      const numericSliderDragState = numericSliderDragStateRef.current;
      if (numericSliderDragState) {
        applyCanvasCursor();
        requestCanvasAnimationLoop();
        updateNumericSliderFromPointer(numericSliderDragState.nodeId, event.global.x, event.global.y);
        return;
      }

      const nodeResizeState = nodeResizeStateRef.current;
      if (nodeResizeState) {
        const currentViewport = viewportRef.current;
        if (!currentViewport) {
          return;
        }

        const scale = currentViewport.scale.x || 1;
        const deltaX = (event.global.x - nodeResizeState.pointerX) / scale;
        const deltaY = (event.global.y - nodeResizeState.pointerY) / scale;
        const resizeHandle = nodeResizeState.handle;
        const resizeFromWest = resizeHandle.includes('w');
        const resizeFromEast = resizeHandle.includes('e');
        const resizeFromNorth = resizeHandle.includes('n');
        const resizeFromSouth = resizeHandle.includes('s');
        let nextLeft = nodeResizeState.x;
        let nextTop = nodeResizeState.y;
        let nextRight = nodeResizeState.x + nodeResizeState.width;
        let nextBottom = nodeResizeState.y + nodeResizeState.height;

        if (resizeFromEast) {
          nextRight = nodeResizeState.x + nodeResizeState.width + deltaX;
        }
        if (resizeFromWest) {
          nextLeft = nodeResizeState.x + deltaX;
        }
        if (resizeFromSouth) {
          nextBottom = nodeResizeState.y + nodeResizeState.height + deltaY;
        }
        if (resizeFromNorth) {
          nextTop = nodeResizeState.y + deltaY;
        }

        if ((nextRight - nextLeft) < nodeResizeState.minWidth) {
          if (resizeFromWest && !resizeFromEast) {
            nextLeft = nextRight - nodeResizeState.minWidth;
          } else {
            nextRight = nextLeft + nodeResizeState.minWidth;
          }
        }
        if ((nextBottom - nextTop) < nodeResizeState.minHeight) {
          if (resizeFromNorth && !resizeFromSouth) {
            nextTop = nextBottom - nodeResizeState.minHeight;
          } else {
            nextBottom = nextTop + nodeResizeState.minHeight;
          }
        }

        const nextX = snapToPixel(nextLeft);
        const nextY = snapToPixel(nextTop);
        const nextWidth = Math.max(
          nodeResizeState.minWidth,
          snapToPixel(nextRight - nextLeft)
        );
        const nextHeight = Math.max(
          nodeResizeState.minHeight,
          snapToPixel(nextBottom - nextTop)
        );

        if (
          nextX !== nodeResizeState.currentX ||
          nextY !== nodeResizeState.currentY ||
          nextWidth !== nodeResizeState.currentWidth ||
          nextHeight !== nodeResizeState.currentHeight
        ) {
          nodeResizeState.currentX = nextX;
          nodeResizeState.currentY = nextY;
          nodeResizeState.currentWidth = nextWidth;
          nodeResizeState.currentHeight = nextHeight;
          nodeCardDraftSizesRef.current.set(nodeResizeState.nodeId, {
            width: nextWidth,
            height: nextHeight,
          });
          nodeCardDraftPositionsRef.current.set(nodeResizeState.nodeId, {
            x: nextX,
            y: nextY,
          });
          renderGraphRef.current();
        }
        applyCanvasCursor();
        return;
      }

      const connectionDrag = connectionDragStateRef.current;
      if (connectionDrag) {
        connectionDrag.pointerX = event.global.x;
        connectionDrag.pointerY = event.global.y;

        const viewportContainer = viewportRef.current;
        if (viewportContainer) {
          const worldPoint = viewportContainer.toLocal(new Point(event.global.x, event.global.y));
          const hoverRadius = (PORT_RADIUS + 8) / Math.max(viewportContainer.scale.x, 0.1);
          let nextHoveredKey: string | null = null;

          for (const [portKey, portPosition] of inputPortPositionsRef.current.entries()) {
            const dx = worldPoint.x - portPosition.x;
            const dy = worldPoint.y - portPosition.y;
            if ((dx * dx) + (dy * dy) <= hoverRadius * hoverRadius) {
              nextHoveredKey = portKey;
              break;
            }
          }

          if (connectionDrag.hoveredInputKey !== nextHoveredKey) {
            if (connectionDrag.hoveredInputKey) {
              setInputPortHighlight(connectionDrag.hoveredInputKey, false);
            }
            if (nextHoveredKey) {
              setInputPortHighlight(nextHoveredKey, true);
            }
            connectionDrag.hoveredInputKey = nextHoveredKey;
          }
        }

        drawConnections();
        return;
      }

      const activeDrawingPath = activeDrawingPathRef.current;
      if (activeDrawingPath) {
        const currentViewport = viewportRef.current;
        if (!currentViewport) {
          return;
        }
        const worldPoint = currentViewport.toLocal(new Point(event.global.x, event.global.y));
        const drawingPosition =
          drawingPositionsRef.current.get(activeDrawingPath.drawingId) ??
          graphRef.current?.drawings?.find((drawing) => drawing.id === activeDrawingPath.drawingId)?.position;
        if (!drawingPosition) {
          activeDrawingPathRef.current = null;
          return;
        }

        const localPoint = {
          x: worldPoint.x - drawingPosition.x,
          y: worldPoint.y - drawingPosition.y,
        };

        const previousPoint = activeDrawingPath.path.points[activeDrawingPath.path.points.length - 1];
        if (
          !previousPoint ||
          Math.hypot(localPoint.x - previousPoint.x, localPoint.y - previousPoint.y) >= DRAW_SMOOTHING_STEP
        ) {
          activeDrawingPath.path.points.push(localPoint);
          drawFreehandStrokes();
        }
        return;
      }

      const activeDrawingDragState = drawingDragStateRef.current;
      if (activeDrawingDragState) {
        const deltaX = event.global.x - activeDrawingDragState.pointerX;
        const deltaY = event.global.y - activeDrawingDragState.pointerY;
        if (
          !activeDrawingDragState.moved &&
          Math.hypot(deltaX, deltaY) < NODE_DRAG_START_THRESHOLD
        ) {
          return;
        }

        const currentViewport = viewportRef.current;
        const drawingVisual = drawingVisualsRef.current.get(activeDrawingDragState.drawingId);
        if (!currentViewport || !drawingVisual) {
          return;
        }

        const scale = currentViewport.scale.x || 1;
        const nextPosition = {
          x: snapToPixel(activeDrawingDragState.drawingX + deltaX / scale),
          y: snapToPixel(activeDrawingDragState.drawingY + deltaY / scale),
        };
        activeDrawingDragState.currentX = nextPosition.x;
        activeDrawingDragState.currentY = nextPosition.y;
        drawingPositionsRef.current.set(activeDrawingDragState.drawingId, nextPosition);
        drawingVisual.container.position.set(nextPosition.x, nextPosition.y);
        activeDrawingDragState.moved = true;
        drawFreehandStrokes();
        drawMinimap();
        return;
      }

      const dragState = nodeDragStateRef.current;
      if (dragState) {
        const currentViewport = viewportRef.current;
        const nodeVisual = nodeVisualsRef.current.get(dragState.nodeId);
        if (!currentViewport || !nodeVisual) return;

        const deltaX = event.global.x - dragState.pointerX;
        const deltaY = event.global.y - dragState.pointerY;
        if (
          !dragState.moved &&
          Math.hypot(deltaX, deltaY) < NODE_DRAG_START_THRESHOLD
        ) {
          return;
        }

        const scale = currentViewport.scale.x || 1;
        const nextPosition = {
          x: snapToPixel(dragState.nodeX + deltaX / scale),
          y: snapToPixel(dragState.nodeY + deltaY / scale),
        };
        dragState.currentX = nextPosition.x;
        dragState.currentY = nextPosition.y;
        nodePositionsRef.current.set(dragState.nodeId, nextPosition);
        nodeVisual.container.position.set(nextPosition.x, nextPosition.y);
        syncNodePortPositions(dragState.nodeId, nextPosition, nodeVisual);
        dragState.moved = true;
        drawConnections();
        drawMinimap();
        return;
      }

      const panState = panStateRef.current;
      if (!panState) return;

      requestCanvasAnimationLoop();
      viewport.position.set(
        snapToPixel(panState.viewportX + (event.global.x - panState.pointerX)),
        snapToPixel(panState.viewportY + (event.global.y - panState.pointerY))
      );
      drawMinimap();
      requestViewportDrivenGraphRefresh();
    };

    const handleStagePointerUp = (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      finishInteraction();
    };

    const handleWheel = (event: WheelEvent) => {
      const currentViewport = viewportRef.current;
      if (!currentViewport) return;

      event.preventDefault();

      // Modifier wheel scroll is explicit panning; default wheel keeps zoom semantics.
      const modifierScrollDelta = resolveModifierWheelScrollDelta(event);
      if (modifierScrollDelta) {
        currentViewport.position.set(
          snapToPixel(currentViewport.position.x + modifierScrollDelta.x),
          snapToPixel(currentViewport.position.y + modifierScrollDelta.y)
        );
        drawMinimap();
        requestViewportDrivenGraphRefresh();
        return;
      }

      if (shouldWheelPanCanvas(event)) {
        currentViewport.position.set(
          snapToPixel(currentViewport.position.x - event.deltaX),
          snapToPixel(currentViewport.position.y - event.deltaY)
        );
        drawMinimap();
        requestViewportDrivenGraphRefresh();
        return;
      }

      const rect = canvasElement.getBoundingClientRect();
      const pointer = new Point(event.clientX - rect.left, event.clientY - rect.top);
      const worldPointBefore = currentViewport.toLocal(pointer);
      const zoomSensitivity = ZOOM_SENSITIVITY * resolveWheelZoomSensitivityMultiplier(event);
      const scaleFactor = Math.exp(-event.deltaY * zoomSensitivity);
      const nextScale = clamp(currentViewport.scale.x * scaleFactor, MIN_ZOOM, MAX_ZOOM);

      currentViewport.scale.set(nextScale);
      updateTextResolutionForScale(nextScale);
      drawFreehandStrokes();
      currentViewport.position.set(
        snapToPixel(pointer.x - worldPointBefore.x * nextScale),
        snapToPixel(pointer.y - worldPointBefore.y * nextScale)
      );
      drawMinimap();
      requestViewportDrivenGraphRefresh();
    };

    const handleResize = () => {
      app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
      refreshCanvasBackgroundTexture();
      drawMinimap();
      drawEffects();
      drawFreehandStrokes();
      requestViewportDrivenGraphRefresh();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const isEditableActiveElement = Boolean(
        activeElement &&
        activeElement !== canvasElement &&
        (activeElement.tagName.toLowerCase() === 'input' ||
          activeElement.tagName.toLowerCase() === 'textarea' ||
          activeElement.isContentEditable)
      );
      if (isEditableActiveElement) {
        return;
      }

      const selectedConnectionId = selectedConnectionIdRef.current;
      if (selectedConnectionId) {
        event.preventDefault();
        deleteConnection(selectedConnectionId);
        selectedConnectionIdRef.current = null;
        drawConnections();
        return;
      }

      const drawingId = selectedDrawingIdRef.current;
      if (drawingId) {
        event.preventDefault();
        deleteDrawing(drawingId);
        selectedDrawingIdRef.current = null;
        drawFreehandStrokes();
        drawMinimap();
        return;
      }

      const selectedNode = selectedNodeIdRef.current;
      if (!selectedNode) {
        return;
      }

      event.preventDefault();
      deleteNode(selectedNode);
      selectedConnectionIdRef.current = null;
      selectedNodeIdRef.current = null;
      selectNode(null);
      drawConnections();
    };

    app.stage.on('pointerdown', handleStagePointerDown);
    app.stage.on('pointermove', handleStagePointerMove);
    app.stage.on('pointerup', handleStagePointerUp);
    app.stage.on('pointerupoutside', handleStagePointerUp);
    app.renderer.on('resize', handleResize);
    canvasElement.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('pointerup', finishInteraction);
    window.addEventListener('keydown', handleKeyDown);
    app.ticker.add(drawEffects);

    renderGraphRef.current();

    return () => {
      if (viewportRefreshRafRef.current !== null) {
        window.cancelAnimationFrame(viewportRefreshRafRef.current);
        viewportRefreshRafRef.current = null;
      }
      window.removeEventListener('pointerup', finishInteraction);
      canvasElement.removeEventListener('wheel', handleWheel);
      app.stage.off('pointerdown', handleStagePointerDown);
      app.stage.off('pointermove', handleStagePointerMove);
      app.stage.off('pointerup', handleStagePointerUp);
      app.stage.off('pointerupoutside', handleStagePointerUp);
      app.renderer.off('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      app.ticker.remove(drawEffects);
      clearAllNodeGraphicsTextures();
      selectedNodeGraphicsDebugRef.current = null;
      setSelectedNodeGraphicsDebug(null);
      app.destroy(true);
      setCanvasReady(false);
      appliedCanvasBackgroundSignatureRef.current = '';
      backgroundSpriteRef.current = null;
      appRef.current = null;
      viewportRef.current = null;
      edgeLayerRef.current = null;
      nodeLayerRef.current = null;
      drawingHandleLayerRef.current = null;
      drawLayerRef.current = null;
      effectsLayerRef.current = null;
    };
  }, [addDrawingPath, applyCanvasCursor, clearAllNodeGraphicsTextures, commitNumericSliderValue, deleteConnection, deleteDrawing, deleteNode, drawConnections, drawEffects, drawFreehandStrokes, drawMinimap, endConnectionDrag, pickConnectionAtClientPoint, refreshCanvasBackgroundTexture, requestCanvasAnimationLoop, requestViewportDrivenGraphRefresh, selectDrawing, selectNode, setInputPortHighlight, setSelectedNodeGraphicsDebug, syncNodePortPositions, updateDrawingPosition, updateGraph, updateNodePosition, updateNumericSliderFromPointer, updateTextResolutionForScale]);

  useEffect(() => {
    const previous = previousNodeExecutionStatesRef.current;
    const current = nodeExecutionStates;

    for (const [nodeId, state] of Object.entries(current)) {
      const previousState = previous[nodeId] ?? FALLBACK_NODE_EXECUTION_STATE;

      if (!previousState.isComputing && state.isComputing) {
        enqueueLightningForNodeInputs(nodeId);
      }

      if (previousState.isComputing && !state.isComputing && !state.hasError) {
        enqueueNodeShock(nodeId);
      }
    }

    previousNodeExecutionStatesRef.current = current;
    renderGraphRef.current();
  }, [enqueueLightningForNodeInputs, enqueueNodeShock, nodeExecutionStates]);

  useEffect(() => {
    renderGraphRef.current();
  }, [nodeGraphicsOutputs]);

  let overlay: ReactNode = null;
  if (isLoading && !graph) {
    overlay = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px' }}>
        <div>Loading...</div>
        {error && <div style={{ color: 'red', fontSize: '12px' }}>Error: {error}</div>}
      </div>
    );
  } else if (!graph) {
    overlay = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '16px' }}>
        <div>No graph loaded</div>
        {error && <div style={{ color: 'red', fontSize: '12px' }}>Error: {error}</div>}
        <button
          onClick={() => {
            createGraph('Untitled Graph');
          }}
          style={{
            padding: '8px 16px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Create New Graph
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
      <div
        ref={canvasHostRef}
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 4,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${annotationOverlayTransform.x}px, ${annotationOverlayTransform.y}px) scale(${annotationOverlayTransform.scale})`,
            transformOrigin: '0 0',
            width: '1px',
            height: '1px',
          }}
        >
          {annotationOverlays.map((overlayEntry) => (
            <div
              key={overlayEntry.nodeId}
              data-testid={`annotation-overlay-${overlayEntry.nodeId}`}
              style={{
                position: 'absolute',
                left: `${overlayEntry.x}px`,
                top: `${overlayEntry.y}px`,
                width: `${overlayEntry.width}px`,
                height: `${overlayEntry.height}px`,
                overflow: 'hidden',
                padding: '4px 6px 6px',
                color: overlayEntry.fontColor,
              }}
            >
              <AnnotationMarkdown
                markdown={overlayEntry.text}
                color={overlayEntry.fontColor}
                fontSize={overlayEntry.fontSize}
              />
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: '14px',
          bottom: '14px',
          width: `${MINIMAP_WIDTH}px`,
          height: `${MINIMAP_HEIGHT}px`,
          borderRadius: '8px',
          border: '1px solid rgba(148, 163, 184, 0.65)',
          background: 'rgba(15, 23, 42, 0.72)',
          backdropFilter: 'blur(2px)',
          boxShadow: '0 8px 24px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
          zIndex: 5,
        }}
      >
        <canvas
          ref={minimapCanvasRef}
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          onPointerDown={handleMinimapPointerDown}
          onWheel={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            cursor: 'pointer',
          }}
        />
      </div>
      {overlay && (
        <div style={{ position: 'absolute', inset: 0 }}>
          {overlay}
        </div>
      )}
    </div>
  );
}

export default Canvas;
