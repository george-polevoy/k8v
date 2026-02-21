import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef } from 'react';
import {
  Application,
  Circle,
  Container,
  FederatedPointerEvent,
  Graphics,
  Point,
  Rectangle,
  settings,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { useGraphStore } from '../store/graphStore';
import type { NodeExecutionState } from '../store/graphStore';
import { GraphNode, Position } from '../types';
import { v4 as uuidv4 } from 'uuid';

const NODE_WIDTH = 220;
const MIN_NODE_HEIGHT = 96;
const HEADER_HEIGHT = 44;
const NODE_BODY_PADDING = 14;
const PORT_SPACING = 22;
const PORT_RADIUS = 4;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const ZOOM_SENSITIVITY = 0.0014;
const VIEWPORT_MARGIN = 100;
const EDGE_HIT_WIDTH = 16;
const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 140;
const MINIMAP_PADDING = 8;
const NODE_DRAG_START_THRESHOLD = 2;
const LIGHTNING_DURATION_MS = 420;
const NODE_SHOCK_DURATION_MS = 520;
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.max(window.devicePixelRatio || 1, 1) : 1;
const MAX_TEXT_RESOLUTION = PIXEL_RATIO * 4;
const FALLBACK_NODE_EXECUTION_STATE: NodeExecutionState = {
  isComputing: false,
  hasError: false,
  errorMessage: null,
  lastRunAt: null,
};

interface NodeVisual {
  node: GraphNode;
  container: Container;
  width: number;
  height: number;
  inputPortOffsets: Map<string, number>;
  outputPortOffsets: Map<string, number>;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function snapToPixel(value: number): number {
  return Math.round(value);
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

function getNodeHeight(node: GraphNode): number {
  const maxPorts = Math.max(node.metadata.inputs.length, node.metadata.outputs.length, 1);
  return Math.max(MIN_NODE_HEIGHT, HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING));
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

function Canvas() {
  const graph = useGraphStore((state) => state.graph);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const nodeExecutionStates = useGraphStore((state) => state.nodeExecutionStates);
  const selectNode = useGraphStore((state) => state.selectNode);
  const updateNodePosition = useGraphStore((state) => state.updateNodePosition);
  const addConnection = useGraphStore((state) => state.addConnection);
  const deleteConnection = useGraphStore((state) => state.deleteConnection);
  const deleteNode = useGraphStore((state) => state.deleteNode);
  const createGraph = useGraphStore((state) => state.createGraph);
  const isLoading = useGraphStore((state) => state.isLoading);
  const error = useGraphStore((state) => state.error);

  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapTransformRef = useRef<MinimapTransform | null>(null);
  const appRef = useRef<Application | null>(null);
  const backgroundSpriteRef = useRef<Sprite | null>(null);
  const viewportRef = useRef<Container | null>(null);
  const nodeLayerRef = useRef<Container | null>(null);
  const edgeLayerRef = useRef<Graphics | null>(null);
  const effectsLayerRef = useRef<Graphics | null>(null);
  const connectionGeometriesRef = useRef<Map<string, ConnectionGeometry>>(new Map());
  const lightningPulsesRef = useRef<LightningPulse[]>([]);
  const nodeShocksRef = useRef<NodeShock[]>([]);
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
  const nodeExecutionStatesRef = useRef(nodeExecutionStates);
  const previousNodeExecutionStatesRef = useRef<Record<string, NodeExecutionState>>({});
  const graphRef = useRef(graph);
  const renderGraphRef = useRef<() => void>(() => {});
  const panStateRef = useRef<PanState | null>(null);
  const nodeDragStateRef = useRef<NodeDragState | null>(null);
  const lastGraphIdRef = useRef<string | null>(null);
  const viewportInitializedRef = useRef(false);
  selectedNodeIdRef.current = selectedNodeId;
  nodeExecutionStatesRef.current = nodeExecutionStates;

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

    if (currentGraph && currentGraph.nodes.length > 0) {
      for (const node of currentGraph.nodes) {
        const position = nodePositionsRef.current.get(node.id) ?? node.position;
        const visual = nodeVisualsRef.current.get(node.id);
        const nodeWidth = visual?.width ?? NODE_WIDTH;
        const nodeHeight = visual?.height ?? getNodeHeight(node);

        minX = Math.min(minX, position.x);
        minY = Math.min(minY, position.y);
        maxX = Math.max(maxX, position.x + nodeWidth);
        maxY = Math.max(maxY, position.y + nodeHeight);
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
        const nodeWidth = visual?.width ?? NODE_WIDTH;
        const nodeHeight = visual?.height ?? getNodeHeight(node);

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
  }, []);

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
    }
  }, []);

  const setOutputPortHighlight = useCallback((portKey: string, highlighted: boolean) => {
    const marker = outputPortMarkersRef.current.get(portKey);
    if (marker) {
      drawOutputPortMarker(marker, highlighted);
    }
  }, []);

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

    edges.clear();
    connectionGeometriesRef.current.clear();
    if (!currentGraph) return;

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
      edges.lineStyle(isSelectedConnection ? 3 : 2, isSelectedConnection ? 0x1d4ed8 : 0x64748b, 0.95);
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

    edges.lineStyle(2, 0x1d4ed8, 0.95);
    drawBezierConnection(edges, dragState.startX, dragState.startY, endX, endY);
  }, []);

  const enqueueLightningForConnection = useCallback((connectionId: string) => {
    const now = performance.now();
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
  }, []);

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
  }, []);

  const drawEffects = useCallback(() => {
    const effectsLayer = effectsLayerRef.current;
    if (!effectsLayer) {
      return;
    }

    effectsLayer.clear();
    const now = performance.now();

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
      effectsLayer.lineStyle(8, 0x60a5fa, 0.55 * alpha);
      drawBezierConnection(
        effectsLayer,
        geometry.startX,
        geometry.startY,
        geometry.endX,
        geometry.endY
      );

      effectsLayer.lineStyle(5.5, 0xfacc15, 1 * alpha);
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
      effectsLayer.beginFill(0xfef08a, 0.95 * alpha);
      effectsLayer.drawCircle(headPoint.x, headPoint.y, 4.5);
      effectsLayer.endFill();
      effectsLayer.lineStyle(1.4, 0xffffff, 0.8 * alpha);
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
      effectsLayer.lineStyle(2.2, 0xfacc15, 0.75 * alpha);
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
      effectsLayer.lineStyle(1, 0xf59e0b, 0.55 * alpha);
      effectsLayer.drawCircle(statusX, statusY, 4 + progress * 7);

      return true;
    });
  }, []);

  const fitViewportToGraph = useCallback(() => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    const currentGraph = graphRef.current;

    if (!app || !viewport) return;

    if (!currentGraph || currentGraph.nodes.length === 0) {
      viewport.scale.set(1);
      viewport.position.set(app.screen.width / 2, app.screen.height / 2);
      updateTextResolutionForScale(1);
      drawMinimap();
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
      maxY = Math.max(maxY, position.y + visual.height);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      viewport.scale.set(1);
      viewport.position.set(app.screen.width / 2, app.screen.height / 2);
      updateTextResolutionForScale(1);
      drawMinimap();
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
  }, [drawMinimap, updateTextResolutionForScale]);

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

  const renderGraph = useCallback(() => {
    const nodesLayer = nodeLayerRef.current;
    const currentGraph = graphRef.current;

    if (!nodesLayer) return;

    nodesLayer.removeChildren();
    nodeVisualsRef.current.clear();
    nodePositionsRef.current.clear();
    textNodesRef.current.clear();
    inputPortMarkersRef.current.clear();
    outputPortMarkersRef.current.clear();
    inputPortPositionsRef.current.clear();
    outputPortPositionsRef.current.clear();
    hoveredInputPortKeyRef.current = null;
    hoveredOutputPortKeyRef.current = null;

    if (!currentGraph) {
      drawConnections();
      return;
    }

    for (const node of currentGraph.nodes) {
      const width = NODE_WIDTH;
      const height = getNodeHeight(node);
      const position = { ...node.position };
      const container = new Container();
      const isSelected = selectedNodeId === node.id;

      container.position.set(snapToPixel(position.x), snapToPixel(position.y));
      container.eventMode = 'static';
      container.cursor = 'pointer';

      const frame = new Graphics();
      frame.lineStyle(2, isSelected ? 0x1d4ed8 : 0x334155, 1);
      frame.beginFill(isSelected ? 0xe2e8f0 : 0xf8fafc, 1);
      frame.drawRoundedRect(0, 0, width, height, 10);
      frame.endFill();
      container.addChild(frame);

      const nodeExecutionState = nodeExecutionStatesRef.current[node.id];
      const autoRecomputeEnabled = Boolean(node.config.config?.autoRecompute);
      const statusLightColor = nodeExecutionState?.hasError
        ? 0xef4444
        : nodeExecutionState?.isComputing
          ? 0xf59e0b
          : autoRecomputeEnabled
            ? 0x22c55e
            : 0x94a3b8;
      const statusLight = new Graphics();
      statusLight.lineStyle(1, 0x0f172a, 0.25);
      statusLight.beginFill(statusLightColor, 1);
      statusLight.drawCircle(width - 14, 14, 5);
      statusLight.endFill();
      container.addChild(statusLight);

      const title = new Text(node.metadata.name, {
        fontFamily: 'Arial',
        fontSize: 14,
        fontWeight: 'bold',
        fill: 0x0f172a,
      });
      title.resolution = PIXEL_RATIO;
      textNodesRef.current.add(title);
      title.position.set(12, 10);
      container.addChild(title);

      const subtitle = new Text(node.type.replace(/_/g, ' '), {
        fontFamily: 'Arial',
        fontSize: 11,
        fill: 0x475569,
      });
      subtitle.resolution = PIXEL_RATIO;
      textNodesRef.current.add(subtitle);
      subtitle.position.set(12, 28);
      container.addChild(subtitle);

      const inputPortOffsets = new Map<string, number>();
      const outputPortOffsets = new Map<string, number>();
      const bodyHeight = height - HEADER_HEIGHT - NODE_BODY_PADDING;
      const inputSlots = Math.max(node.metadata.inputs.length, 1);
      const outputSlots = Math.max(node.metadata.outputs.length, 1);

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
          event.stopPropagation();
          hoveredInputPortKeyRef.current = portKey;
          drawInputPortMarker(marker, true);
          const dragState = connectionDragStateRef.current;
          if (dragState) {
            dragState.hoveredInputKey = portKey;
            drawConnections();
          }
        });
        marker.on('pointerout', (event: FederatedPointerEvent) => {
          event.stopPropagation();
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
        const y = HEADER_HEIGHT + ((i + 1) * bodyHeight) / (outputSlots + 1);
        outputPortOffsets.set(port.name, y);

        const marker = new Graphics();
        drawOutputPortMarker(marker, false);
        marker.eventMode = 'static';
        marker.cursor = 'crosshair';
        marker.hitArea = new Circle(0, 0, PORT_RADIUS + 8);
        marker.position.set(width, y);
        marker.on('pointerover', (event: FederatedPointerEvent) => {
          event.stopPropagation();
          hoveredOutputPortKeyRef.current = portKey;
          drawOutputPortMarker(marker, true);
        });
        marker.on('pointerout', (event: FederatedPointerEvent) => {
          event.stopPropagation();
          if (hoveredOutputPortKeyRef.current === portKey) {
            hoveredOutputPortKeyRef.current = null;
          }
          if (connectionDragStateRef.current?.sourcePortKey !== portKey) {
            drawOutputPortMarker(marker, false);
          }
        });
        marker.on('pointerdown', (event: FederatedPointerEvent) => {
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

      container.on('pointerdown', (event: FederatedPointerEvent) => {
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
        inputPortOffsets,
        outputPortOffsets,
      });
      syncNodePortPositions(node.id, position, {
        node,
        container,
        width,
        height,
        inputPortOffsets,
        outputPortOffsets,
      });
    }

    drawConnections();

    if (!viewportInitializedRef.current) {
      fitViewportToGraph();
      viewportInitializedRef.current = true;
    }
    const viewport = viewportRef.current;
    if (viewport) {
      updateTextResolutionForScale(viewport.scale.x);
    }
    drawMinimap();
  }, [drawConnections, drawMinimap, fitViewportToGraph, selectNode, selectedNodeId, syncNodePortPositions, updateTextResolutionForScale]);

  useEffect(() => {
    renderGraphRef.current = renderGraph;
  }, [renderGraph]);

  useEffect(() => {
    graphRef.current = graph;

    const nextGraphId = graph?.id ?? null;
    if (lastGraphIdRef.current !== nextGraphId) {
      lastGraphIdRef.current = nextGraphId;
      viewportInitializedRef.current = false;
    }

    if (
      selectedConnectionIdRef.current &&
      !graph?.connections.some((connection) => connection.id === selectedConnectionIdRef.current)
    ) {
      selectedConnectionIdRef.current = null;
    }

    renderGraph();
  }, [graph, renderGraph]);

  useEffect(() => {
    renderGraphRef.current();
  }, [selectedNodeId, renderGraph]);

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
    host.appendChild(app.view as HTMLCanvasElement);

    const viewport = new Container();
    const edgeLayer = new Graphics();
    const nodeLayer = new Container();
    const effectsLayer = new Graphics();
    effectsLayer.eventMode = 'none';
    const createBackgroundTexture = () => {
      const width = Math.max(2, Math.round(app.screen.width * PIXEL_RATIO));
      const height = Math.max(2, Math.round(app.screen.height * PIXEL_RATIO));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return Texture.WHITE;
      }

      const gradient = ctx.createRadialGradient(
        width * 0.12,
        height * 0.08,
        width * 0.06,
        width * 0.52,
        height * 0.56,
        Math.max(width, height) * 0.9
      );
      gradient.addColorStop(0, '#325da3');
      gradient.addColorStop(0.35, '#1d437e');
      gradient.addColorStop(0.7, '#112d58');
      gradient.addColorStop(1, '#08172f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      return Texture.from(canvas);
    };

    const backgroundSprite = new Sprite(createBackgroundTexture());
    backgroundSpriteRef.current = backgroundSprite;
    backgroundSprite.position.set(0, 0);
    backgroundSprite.width = app.screen.width;
    backgroundSprite.height = app.screen.height;
    backgroundSprite.eventMode = 'none';

    viewportRef.current = viewport;
    edgeLayerRef.current = edgeLayer;
    nodeLayerRef.current = nodeLayer;
    effectsLayerRef.current = effectsLayer;
    app.stage.addChild(backgroundSprite);
    viewport.addChild(edgeLayer);
    viewport.addChild(nodeLayer);
    viewport.addChild(effectsLayer);
    app.stage.addChild(viewport);

    app.stage.eventMode = 'static';
    app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);

    const canvasElement = app.view as HTMLCanvasElement;
    canvasElement.style.display = 'block';
    canvasElement.style.width = '100%';
    canvasElement.style.height = '100%';
    canvasElement.style.cursor = 'grab';
    canvasElement.style.touchAction = 'none';
    canvasElement.tabIndex = 0;
    canvasElement.style.outline = 'none';

      const finishInteraction = () => {
      if (connectionDragStateRef.current) {
        endConnectionDrag(true);
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

      panStateRef.current = null;
      canvasElement.style.cursor = 'grab';
    };

    const handleStagePointerDown = (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      canvasElement.focus({ preventScroll: true });

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
      canvasElement.style.cursor = 'grabbing';
      if (selectedConnectionIdRef.current) {
        selectedConnectionIdRef.current = null;
        drawConnections();
      }
      selectedNodeIdRef.current = null;
      selectNode(null);
    };

    const handleStagePointerMove = (event: FederatedPointerEvent) => {
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

      viewport.position.set(
        snapToPixel(panState.viewportX + (event.global.x - panState.pointerX)),
        snapToPixel(panState.viewportY + (event.global.y - panState.pointerY))
      );
      drawMinimap();
    };

    const handleStagePointerUp = (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      finishInteraction();
    };

    const handleWheel = (event: WheelEvent) => {
      const currentViewport = viewportRef.current;
      if (!currentViewport) return;

      event.preventDefault();

      // Shift/Alt wheel performs directional scrolling while default wheel zooms.
      if (event.shiftKey || event.altKey) {
        currentViewport.position.set(
          snapToPixel(currentViewport.position.x - event.deltaX - event.deltaY),
          snapToPixel(currentViewport.position.y - event.deltaY)
        );
        drawMinimap();
        return;
      }

      const rect = canvasElement.getBoundingClientRect();
      const pointer = new Point(event.clientX - rect.left, event.clientY - rect.top);
      const worldPointBefore = currentViewport.toLocal(pointer);
      const scaleFactor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
      const nextScale = clamp(currentViewport.scale.x * scaleFactor, MIN_ZOOM, MAX_ZOOM);

      currentViewport.scale.set(nextScale);
      updateTextResolutionForScale(nextScale);
      currentViewport.position.set(
        snapToPixel(pointer.x - worldPointBefore.x * nextScale),
        snapToPixel(pointer.y - worldPointBefore.y * nextScale)
      );
      drawMinimap();
    };

    const handleResize = () => {
      app.stage.hitArea = new Rectangle(0, 0, app.screen.width, app.screen.height);
      const background = backgroundSpriteRef.current;
      if (background) {
        const previousTexture = background.texture;
        background.texture = createBackgroundTexture();
        background.width = app.screen.width;
        background.height = app.screen.height;
        if (previousTexture !== Texture.WHITE) {
          previousTexture.destroy(true);
        }
      }
      drawMinimap();
      drawEffects();
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

    renderGraph();

    return () => {
      window.removeEventListener('pointerup', finishInteraction);
      canvasElement.removeEventListener('wheel', handleWheel);
      app.stage.off('pointerdown', handleStagePointerDown);
      app.stage.off('pointermove', handleStagePointerMove);
      app.stage.off('pointerup', handleStagePointerUp);
      app.stage.off('pointerupoutside', handleStagePointerUp);
      app.renderer.off('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      app.ticker.remove(drawEffects);
      app.destroy(true);
      backgroundSpriteRef.current = null;
      appRef.current = null;
      viewportRef.current = null;
      edgeLayerRef.current = null;
      nodeLayerRef.current = null;
      effectsLayerRef.current = null;
    };
  }, [deleteConnection, deleteNode, drawConnections, drawEffects, drawMinimap, endConnectionDrag, pickConnectionAtClientPoint, selectNode, setInputPortHighlight, syncNodePortPositions, updateNodePosition, updateTextResolutionForScale]);

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
