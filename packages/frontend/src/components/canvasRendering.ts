import {
  Graphics,
  Matrix,
  Texture,
  WRAP_MODES,
} from 'pixi.js';
import type {
  NodeGraphicsComputationDebug,
  PencilColor,
} from '../store/graphStore';
import type {
  CanvasBackgroundSettings,
  ConnectionAnchorSide,
  GraphNode,
} from '../types';
import { NodeType } from '../types';
import { deriveGradientStops } from '../utils/canvasBackground';
import { clamp, snapToPixel } from '../utils/canvasHelpers';
import type { ConnectionGeometry } from '../utils/canvasEffects';
import { hexColorToNumber } from '../utils/color';
import {
  formatNumericInputValue,
  snapNumericInputValue,
} from '../utils/numericInput';
import {
  NODE_MIN_WIDTH,
  NODE_WIDTH,
  resolveStandardNodeMinHeight,
} from '../../../shared/src/nodeCardGeometry.js';
import {
  type AnnotationOverlayEntry,
  type NodeCardDimensions,
  type NumericSliderVisual,
} from './canvasTypes';
import { getBezierGeometry } from './canvasGeometry';

const ANNOTATION_NODE_MIN_WIDTH = 140;
const ANNOTATION_NODE_MIN_HEIGHT = 84;
const NUMERIC_SLIDER_TRACK_WIDTH = 4;
const NUMERIC_SLIDER_KNOB_RADIUS = 7;
const NODE_CARD_BACKGROUND_ALPHA = 0.8;
const NODE_CARD_BACKGROUND_BOTTOM_ALPHA = 0.2;
const NODE_CARD_BORDER_WIDTH = 1.5;
const NODE_CARD_BORDER_MAX_ALPHA = 0.5;
const NODE_CARD_BORDER_PATTERN_WIDTH = 8;
const NODE_CARD_BORDER_PATTERN_HEIGHT = 256;
const NODE_CARD_CORNER_RADIUS = 20;
const NODE_CARD_BACKGROUND_PATTERN_WIDTH = 8;
const NODE_CARD_BACKGROUND_PATTERN_HEIGHT = 256;
const PORT_RADIUS = 4;
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;

let nodeCardBorderTexture: Texture | null = null;
let nodeCardBackgroundFadeTexture: Texture | null = null;

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveNumericSliderValue(localX: number, slider: NumericSliderVisual): number {
  if (slider.trackWidth <= 0 || slider.max <= slider.min) {
    return slider.min;
  }

  const ratio = clamp((localX - slider.trackX) / slider.trackWidth, 0, 1);
  const rawValue = slider.min + (ratio * (slider.max - slider.min));
  return snapNumericInputValue(rawValue, slider.min, slider.max, slider.step);
}

export function drawNumericSliderVisual(slider: NumericSliderVisual): void {
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

export function drawInputPortMarker(marker: Graphics, highlighted: boolean): void {
  marker.clear();
  marker.beginFill(highlighted ? 0x2563eb : 0x1d4ed8);
  marker.drawCircle(0, 0, highlighted ? PORT_RADIUS + 2 : PORT_RADIUS);
  marker.endFill();
}

export function drawOutputPortMarker(marker: Graphics, highlighted: boolean): void {
  marker.clear();
  marker.beginFill(highlighted ? 0x22c55e : 0x16a34a);
  marker.drawCircle(0, 0, highlighted ? PORT_RADIUS + 2 : PORT_RADIUS);
  marker.endFill();
}

export function resolvePencilColor(color: PencilColor): number {
  return hexColorToNumber(color, '#ffffff');
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
  return resolveStandardNodeMinHeight(
    node.metadata.inputs.length,
    node.metadata.outputs.length,
    node.type === NodeType.NUMERIC_INPUT
  );
}

export function resolveNodeCardDimensions(
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

export function areAnnotationOverlaysEqual(
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

export function getCanvasBackgroundSignature(
  background: CanvasBackgroundSettings,
  width: number,
  height: number
): string {
  return `${background.mode}:${background.baseColor}:${Math.round(width)}x${Math.round(height)}`;
}

export function createCanvasBackgroundTexture(
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

export function blendPixiColors(baseColor: number, targetColor: number, amount: number): number {
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

export function drawNodeCardFrame(
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

  if (safeStrokeAlpha <= 0 || width <= strokeInset * 2 || height <= strokeInset * 2) {
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

export function drawBezierConnection(
  graphics: Graphics,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  startSide: ConnectionAnchorSide = 'right',
  endSide: ConnectionAnchorSide = 'left'
): void {
  const geometry = getBezierGeometry('preview', startX, startY, endX, endY, startSide, endSide);
  graphics.moveTo(startX, startY);
  graphics.bezierCurveTo(
    geometry.c1X,
    geometry.c1Y,
    geometry.c2X,
    geometry.c2Y,
    endX,
    endY
  );
}

export function drawConnectionArrowHead(
  graphics: Graphics,
  geometry: ConnectionGeometry,
  color: number,
  alpha: number,
  length: number,
  width: number
): void {
  const directionX = geometry.endX - geometry.c2X;
  const directionY = geometry.endY - geometry.c2Y;
  const magnitude = Math.hypot(directionX, directionY);
  if (magnitude < 1e-6) {
    return;
  }

  const unitX = directionX / magnitude;
  const unitY = directionY / magnitude;
  const perpendicularX = -unitY;
  const perpendicularY = unitX;
  const baseX = geometry.endX - (unitX * length);
  const baseY = geometry.endY - (unitY * length);
  const halfWidth = width * 0.5;

  graphics.beginFill(color, alpha);
  graphics.drawPolygon([
    geometry.endX,
    geometry.endY,
    baseX + (perpendicularX * halfWidth),
    baseY + (perpendicularY * halfWidth),
    baseX - (perpendicularX * halfWidth),
    baseY - (perpendicularY * halfWidth),
  ]);
  graphics.endFill();
}

export function areNodeGraphicsDebugValuesEqual(
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
