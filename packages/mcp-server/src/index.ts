import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { chromium } from 'playwright';
import { z } from 'zod';

const DEFAULT_BACKEND_URL = process.env.K8V_BACKEND_URL ?? 'http://127.0.0.1:3000';
const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

type RuntimeId = 'javascript_vm' | string;

type NodeType =
  | 'inline_code'
  | 'library'
  | 'subgraph'
  | 'external_input'
  | 'external_output';

interface DataSchema {
  type: string;
  [key: string]: unknown;
}

interface PortDefinition {
  name: string;
  schema: DataSchema;
  description?: string;
}

interface PythonEnvironment {
  name: string;
  pythonPath: string;
  cwd: string;
}

interface DrawingPoint {
  x: number;
  y: number;
}

type DrawingColor = 'white' | 'green' | 'red';

interface DrawingPath {
  id: string;
  color: DrawingColor;
  thickness: number;
  points: DrawingPoint[];
}

interface GraphDrawing {
  id: string;
  name: string;
  position: { x: number; y: number };
  paths: DrawingPath[];
}

interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  metadata: {
    name: string;
    description?: string;
    inputs: PortDefinition[];
    outputs: PortDefinition[];
    category?: string;
    version?: string;
  };
  config: {
    type: NodeType;
    code?: string;
    libraryId?: string;
    subgraphId?: string;
    runtime?: RuntimeId;
    pythonEnv?: string;
    config?: Record<string, unknown>;
  };
  version: string;
  lastComputed?: number;
}

interface Connection {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

interface Graph {
  id: string;
  name: string;
  nodes: GraphNode[];
  connections: Connection[];
  pythonEnvs?: PythonEnvironment[];
  drawings?: GraphDrawing[];
  createdAt: number;
  updatedAt: number;
}

interface RenderRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RenderBitmap {
  width: number;
  height: number;
}

interface GraphNodeNumberState {
  nextNumber: number;
  byNodeId: Map<string, number>;
}

const graphNodeNumbers = new Map<string, GraphNodeNumberState>();

function getStableNodeNumbers(graph: Graph): Record<string, number> {
  let state = graphNodeNumbers.get(graph.id);
  if (!state) {
    state = {
      nextNumber: 1,
      byNodeId: new Map<string, number>(),
    };
    graphNodeNumbers.set(graph.id, state);
  }

  for (const node of graph.nodes) {
    if (!state.byNodeId.has(node.id)) {
      state.byNodeId.set(node.id, state.nextNumber);
      state.nextNumber += 1;
    }
  }

  return Object.fromEntries(
    graph.nodes.map((node) => [node.id, state.byNodeId.get(node.id) ?? -1])
  );
}

const RENDERER_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      #graph-canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <canvas id="graph-canvas"></canvas>
    <script>
      (function () {
        const NODE_WIDTH = 220;
        const MIN_NODE_HEIGHT = 96;
        const HEADER_HEIGHT = 44;
        const NODE_BODY_PADDING = 14;
        const PORT_SPACING = 22;
        const PORT_RADIUS = 4;

        function clamp(value, min, max) {
          return Math.min(Math.max(value, min), max);
        }

        function getNodeHeight(node) {
          const maxPorts = Math.max(node.metadata.inputs.length, node.metadata.outputs.length, 1);
          return Math.max(MIN_NODE_HEIGHT, HEADER_HEIGHT + NODE_BODY_PADDING + (maxPorts * PORT_SPACING));
        }

        function getInputPortOffsetY(node, portName) {
          const height = getNodeHeight(node);
          const bodyHeight = height - HEADER_HEIGHT - NODE_BODY_PADDING;
          const slots = Math.max(node.metadata.inputs.length, 1);
          const index = Math.max(0, node.metadata.inputs.findIndex((port) => port.name === portName));
          return HEADER_HEIGHT + ((index + 1) * bodyHeight) / (slots + 1);
        }

        function getOutputPortOffsetY(node, portName) {
          const height = getNodeHeight(node);
          const bodyHeight = height - HEADER_HEIGHT - NODE_BODY_PADDING;
          const slots = Math.max(node.metadata.outputs.length, 1);
          const index = Math.max(0, node.metadata.outputs.findIndex((port) => port.name === portName));
          return HEADER_HEIGHT + ((index + 1) * bodyHeight) / (slots + 1);
        }

        function mapPoint(x, y, region, bitmap) {
          const scaleX = bitmap.width / Math.max(region.width, 1);
          const scaleY = bitmap.height / Math.max(region.height, 1);
          return {
            x: (x - region.x) * scaleX,
            y: (y - region.y) * scaleY,
            scaleX,
            scaleY,
          };
        }

        function drawRoundedRect(ctx, x, y, width, height, radius) {
          const r = clamp(radius, 0, Math.min(width, height) * 0.5);
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + width - r, y);
          ctx.quadraticCurveTo(x + width, y, x + width, y + r);
          ctx.lineTo(x + width, y + height - r);
          ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
          ctx.lineTo(x + r, y + height);
          ctx.quadraticCurveTo(x, y + height, x, y + height - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        }

        function drawGradientBackground(ctx, bitmap) {
          const gradient = ctx.createRadialGradient(
            bitmap.width * 0.12,
            bitmap.height * 0.08,
            bitmap.width * 0.05,
            bitmap.width * 0.52,
            bitmap.height * 0.56,
            Math.max(bitmap.width, bitmap.height) * 0.9
          );
          gradient.addColorStop(0, '#325da3');
          gradient.addColorStop(0.35, '#1d437e');
          gradient.addColorStop(0.7, '#112d58');
          gradient.addColorStop(1, '#08172f');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, bitmap.width, bitmap.height);
        }

        function drawConnections(ctx, graph, nodeMap, region, bitmap) {
          const scaleRef = bitmap.width / Math.max(region.width, 1);
          const lineWidth = Math.max(1, 2 * scaleRef);
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = lineWidth;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          for (const connection of graph.connections) {
            const sourceNode = nodeMap.get(connection.sourceNodeId);
            const targetNode = nodeMap.get(connection.targetNodeId);
            if (!sourceNode || !targetNode) {
              continue;
            }

            const sourceX = sourceNode.position.x + NODE_WIDTH;
            const sourceY = sourceNode.position.y + getOutputPortOffsetY(sourceNode, connection.sourcePort);
            const targetX = targetNode.position.x;
            const targetY = targetNode.position.y + getInputPortOffsetY(targetNode, connection.targetPort);

            const mappedStart = mapPoint(sourceX, sourceY, region, bitmap);
            const mappedEnd = mapPoint(targetX, targetY, region, bitmap);
            const controlOffset = Math.max(Math.abs(mappedEnd.x - mappedStart.x) * 0.4, 60 * scaleRef);

            ctx.beginPath();
            ctx.moveTo(mappedStart.x, mappedStart.y);
            ctx.bezierCurveTo(
              mappedStart.x + controlOffset,
              mappedStart.y,
              mappedEnd.x - controlOffset,
              mappedEnd.y,
              mappedEnd.x,
              mappedEnd.y
            );
            ctx.stroke();
          }
        }

        function resolveDrawingColor(color) {
          if (color === 'green') return '#22c55e';
          if (color === 'red') return '#ef4444';
          return '#ffffff';
        }

        function drawDrawings(ctx, graph, region, bitmap) {
          const scaleX = bitmap.width / Math.max(region.width, 1);
          const scaleY = bitmap.height / Math.max(region.height, 1);
          const scaleRef = Math.min(scaleX, scaleY);
          const drawings = Array.isArray(graph.drawings) ? graph.drawings : [];

          for (const drawing of drawings) {
            const drawingOrigin = drawing.position || { x: 0, y: 0 };

            for (const path of drawing.paths || []) {
              const points = Array.isArray(path.points) ? path.points : [];
              if (points.length === 0) {
                continue;
              }

              const lineWidth = Math.max(0.5, (path.thickness || 1) * scaleRef);
              ctx.strokeStyle = resolveDrawingColor(path.color);
              ctx.fillStyle = resolveDrawingColor(path.color);
              ctx.lineWidth = lineWidth;
              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';

              const first = mapPoint(
                drawingOrigin.x + points[0].x,
                drawingOrigin.y + points[0].y,
                region,
                bitmap
              );

              if (points.length === 1) {
                ctx.beginPath();
                ctx.arc(first.x, first.y, Math.max(lineWidth * 0.5, 1.25), 0, Math.PI * 2);
                ctx.fill();
                continue;
              }

              ctx.beginPath();
              ctx.moveTo(first.x, first.y);
              for (let i = 1; i < points.length; i += 1) {
                const mapped = mapPoint(
                  drawingOrigin.x + points[i].x,
                  drawingOrigin.y + points[i].y,
                  region,
                  bitmap
                );
                ctx.lineTo(mapped.x, mapped.y);
              }
              ctx.stroke();
            }

            const handlePoint = mapPoint(drawingOrigin.x, drawingOrigin.y, region, bitmap);
            const handleWidth = Math.max(56 * scaleX, (String(drawing.name || '').length + 2) * 8 * scaleRef);
            const handleHeight = Math.max(20 * scaleY, 16 * scaleRef);
            drawRoundedRect(ctx, handlePoint.x, handlePoint.y, handleWidth, handleHeight, 6 * scaleRef);
            ctx.fillStyle = '#e2e8f0';
            ctx.fill();
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = Math.max(1, 1.2 * scaleRef);
            ctx.stroke();

            ctx.fillStyle = '#0f172a';
            ctx.font = '700 ' + Math.max(7, Math.round(10 * scaleRef)) + 'px Arial';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(drawing.name || 'Drawing'), handlePoint.x + (8 * scaleX), handlePoint.y + handleHeight / 2);
          }
        }

        function drawNodes(ctx, graph, region, bitmap, nodeNumbers) {
          const scaleX = bitmap.width / Math.max(region.width, 1);
          const scaleY = bitmap.height / Math.max(region.height, 1);
          const scaleRef = Math.min(scaleX, scaleY);
          const titleFont = Math.max(8, Math.round(14 * scaleRef));
          const subtitleFont = Math.max(7, Math.round(11 * scaleRef));
          const portFont = Math.max(7, Math.round(10 * scaleRef));

          for (const node of graph.nodes) {
            const nodeHeight = getNodeHeight(node);
            const mappedTopLeft = mapPoint(node.position.x, node.position.y, region, bitmap);
            const width = NODE_WIDTH * scaleX;
            const height = nodeHeight * scaleY;
            const borderRadius = 10 * scaleRef;

            drawRoundedRect(ctx, mappedTopLeft.x, mappedTopLeft.y, width, height, borderRadius);
            ctx.fillStyle = '#f8fafc';
            ctx.fill();
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = Math.max(1, 2 * scaleRef);
            ctx.stroke();

            const statusColor = node.config?.config?.autoRecompute ? '#22c55e' : '#94a3b8';
            const statusX = mappedTopLeft.x + width - (14 * scaleX);
            const statusY = mappedTopLeft.y + (14 * scaleY);
            const statusRadius = Math.max(2, 5 * scaleRef);
            ctx.beginPath();
            ctx.arc(statusX, statusY, statusRadius, 0, Math.PI * 2);
            ctx.fillStyle = statusColor;
            ctx.fill();

            const nodeNumber = nodeNumbers ? nodeNumbers[node.id] : undefined;
            if (Number.isFinite(nodeNumber)) {
              const badgeX = mappedTopLeft.x + (8 * scaleX);
              const badgeY = mappedTopLeft.y + (7 * scaleY);
              const badgeWidth = Math.max(26 * scaleX, (String(nodeNumber).length + 1.3) * 11 * scaleRef);
              const badgeHeight = Math.max(18 * scaleY, 18 * scaleRef);
              drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 6 * scaleRef);
              ctx.fillStyle = '#dbeafe';
              ctx.fill();
              ctx.strokeStyle = '#1d4ed8';
              ctx.lineWidth = Math.max(1, 1.2 * scaleRef);
              ctx.stroke();
              ctx.fillStyle = '#1e3a8a';
              ctx.font = '700 ' + Math.max(8, Math.round(11 * scaleRef)) + 'px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(String(nodeNumber), badgeX + badgeWidth / 2, badgeY + badgeHeight / 2);
            }

            const titleX = mappedTopLeft.x + (nodeNumber ? 42 * scaleX : 12 * scaleX);

            ctx.fillStyle = '#0f172a';
            ctx.font = '700 ' + titleFont + 'px Arial';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(node.metadata.name, titleX, mappedTopLeft.y + (10 * scaleY));

            ctx.fillStyle = '#475569';
            ctx.font = '400 ' + subtitleFont + 'px Arial';
            ctx.fillText(String(node.type).replace(/_/g, ' '), titleX, mappedTopLeft.y + (28 * scaleY));

            const bodyHeight = nodeHeight - HEADER_HEIGHT - NODE_BODY_PADDING;
            const inputSlots = Math.max(node.metadata.inputs.length, 1);
            const outputSlots = Math.max(node.metadata.outputs.length, 1);

            ctx.font = '400 ' + portFont + 'px Arial';

            for (let i = 0; i < node.metadata.inputs.length; i += 1) {
              const port = node.metadata.inputs[i];
              const offsetY = HEADER_HEIGHT + ((i + 1) * bodyHeight) / (inputSlots + 1);
              const portY = mappedTopLeft.y + offsetY * scaleY;
              const portX = mappedTopLeft.x;

              ctx.beginPath();
              ctx.arc(portX, portY, Math.max(2, PORT_RADIUS * scaleRef), 0, Math.PI * 2);
              ctx.fillStyle = '#1d4ed8';
              ctx.fill();

              ctx.fillStyle = '#1e293b';
              ctx.textAlign = 'left';
              ctx.fillText(port.name, mappedTopLeft.x + (10 * scaleX), portY - (7 * scaleY));
            }

            for (let i = 0; i < node.metadata.outputs.length; i += 1) {
              const port = node.metadata.outputs[i];
              const offsetY = HEADER_HEIGHT + ((i + 1) * bodyHeight) / (outputSlots + 1);
              const portY = mappedTopLeft.y + offsetY * scaleY;
              const portX = mappedTopLeft.x + width;

              ctx.beginPath();
              ctx.arc(portX, portY, Math.max(2, PORT_RADIUS * scaleRef), 0, Math.PI * 2);
              ctx.fillStyle = '#16a34a';
              ctx.fill();

              ctx.fillStyle = '#1e293b';
              ctx.textAlign = 'right';
              ctx.fillText(port.name, mappedTopLeft.x + width - (10 * scaleX), portY - (7 * scaleY));
            }
          }
        }

        window.renderGraphRegion = function (payload) {
          const canvas = document.getElementById('graph-canvas');
          if (!canvas) {
            throw new Error('Missing #graph-canvas');
          }

          canvas.width = payload.bitmap.width;
          canvas.height = payload.bitmap.height;

          const ctx = canvas.getContext('2d', { alpha: true, desynchronized: false });
          if (!ctx) {
            throw new Error('Could not create 2d context');
          }

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, payload.bitmap.width, payload.bitmap.height);
          drawGradientBackground(ctx, payload.bitmap);

          const nodeMap = new Map(payload.graph.nodes.map((node) => [node.id, node]));
          drawConnections(ctx, payload.graph, nodeMap, payload.region, payload.bitmap);
          drawDrawings(ctx, payload.graph, payload.region, payload.bitmap);
          drawNodes(ctx, payload.graph, payload.region, payload.bitmap, payload.nodeNumbers);

          window.__graphRenderReady = true;
        };
      })();
    </script>
  </body>
</html>`;

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function sanitizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function requestJson<T>(
  baseUrl: string,
  endpoint: string,
  init?: RequestInit
): Promise<T> {
  const normalizedBaseUrl = sanitizeBaseUrl(baseUrl);
  const response = await fetch(`${normalizedBaseUrl}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const raw = await response.text();
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    const message =
      typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Request failed (${response.status} ${response.statusText})`;
    throw new Error(message);
  }

  return parsed as T;
}

function resolveBackendUrl(explicitUrl?: string): string {
  return sanitizeBaseUrl(explicitUrl ?? DEFAULT_BACKEND_URL);
}

function normalizeGraph(graph: Graph): Graph {
  return {
    ...graph,
    drawings: Array.isArray(graph.drawings) ? graph.drawings : [],
    pythonEnvs: Array.isArray(graph.pythonEnvs) ? graph.pythonEnvs : [],
  };
}

async function getGraph(backendUrl: string, graphId: string): Promise<Graph> {
  const graph = await requestJson<Graph>(backendUrl, `/api/graphs/${encodeURIComponent(graphId)}`);
  return normalizeGraph(graph);
}

async function updateGraph(
  backendUrl: string,
  graphId: string,
  mutate: (graph: Graph) => Graph
): Promise<Graph> {
  const currentGraph = await getGraph(backendUrl, graphId);
  const nextGraph = normalizeGraph(mutate(structuredClone(currentGraph)));
  const body = {
    ...nextGraph,
    id: graphId,
    updatedAt: Date.now(),
  };

  const persisted = await requestJson<Graph>(backendUrl, `/api/graphs/${encodeURIComponent(graphId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return normalizeGraph(persisted);
}

function getNode(graph: Graph, nodeId: string): GraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph ${graph.id}`);
  }
  return node;
}

function assertValidPortName(name: string, kind: 'input' | 'output'): void {
  if (!PORT_NAME_PATTERN.test(name)) {
    throw new Error(
      `${kind} port name "${name}" is invalid. Use letters/numbers/underscore and start with letter/underscore.`
    );
  }
}

function ensureNodeVersion(node: GraphNode): string {
  return `${Date.now()}-${node.id}`;
}

function resolveOutputPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(process.cwd(), explicitPath);
  }

  return path.resolve(
    process.cwd(),
    'tmp',
    'mcp-screenshots',
    `graph-region-${Date.now()}.png`
  );
}

async function renderGraphRegionScreenshot(params: {
  graph: Graph;
  nodeNumbers: Record<string, number>;
  region: RenderRegion;
  bitmap: RenderBitmap;
  outputPath?: string;
  includeBase64?: boolean;
}): Promise<{ outputPath: string; bytes: number; base64?: string }> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  try {
    const context = await browser.newContext({
      viewport: {
        width: Math.round(params.bitmap.width),
        height: Math.round(params.bitmap.height),
      },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();
    await page.setContent(RENDERER_HTML, { waitUntil: 'load' });

    await page.evaluate(
      (payload) => {
        (window as any).__graphRenderReady = false;
        (window as any).renderGraphRegion(payload);
      },
      {
        graph: params.graph,
        nodeNumbers: params.nodeNumbers,
        region: params.region,
        bitmap: params.bitmap,
      }
    );

    await page.waitForFunction(() => {
      return Boolean((window as any).__graphRenderReady);
    });

    const outputPath = resolveOutputPath(params.outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const canvas = page.locator('#graph-canvas');
    const imageBuffer = await canvas.screenshot({
      path: outputPath,
      type: 'png',
    });

    await context.close();

    return {
      outputPath,
      bytes: imageBuffer.byteLength,
      ...(params.includeBase64
        ? {
            base64: imageBuffer.toString('base64'),
          }
        : {}),
    };
  } finally {
    await browser.close();
  }
}

const server: any = new McpServer({
  name: 'k8v-mcp-server',
  version: '0.1.0',
});

server.registerTool(
  'graph_list',
  {
    description: 'List available graphs.',
    inputSchema: {
      backendUrl: z.string().optional(),
    },
  },
  async ({ backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const response = await requestJson<{ graphs: Array<{ id: string; name: string; updated_at: number }> }>(
      resolvedBackendUrl,
      '/api/graphs'
    );
    return textResult(response);
  }
);

server.registerTool(
  'graph_get',
  {
    description: 'Get a graph by id, or the latest graph when graphId is omitted.',
    inputSchema: {
      graphId: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = graphId
      ? await getGraph(resolvedBackendUrl, graphId)
      : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));

    return textResult(graph);
  }
);

server.registerTool(
  'graph_create',
  {
    description: 'Create a new empty graph.',
    inputSchema: {
      name: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs', {
      method: 'POST',
      body: JSON.stringify({ name: name ?? 'Untitled Graph' }),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'graph_set_name',
  {
    description: 'Update the graph display name.',
    inputSchema: {
      graphId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      name,
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'graph_python_env_add',
  {
    description: 'Add a named Python environment definition to a graph.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().trim().min(1),
      pythonPath: z.string().trim().min(1),
      cwd: z.string().trim().min(1),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, pythonPath, cwd, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const existingEnvs = current.pythonEnvs ?? [];
      if (existingEnvs.some((env) => env.name === name)) {
        throw new Error(`Python environment "${name}" already exists in graph ${graphId}`);
      }

      return {
        ...current,
        pythonEnvs: [
          ...existingEnvs,
          {
            name,
            pythonPath,
            cwd,
          },
        ],
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'graph_python_env_edit',
  {
    description:
      'Edit an existing graph Python environment by name (rename and/or update pythonPath/cwd).',
    inputSchema: {
      graphId: z.string(),
      envName: z.string().trim().min(1),
      name: z.string().trim().min(1).optional(),
      pythonPath: z.string().trim().min(1).optional(),
      cwd: z.string().trim().min(1).optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, envName, name, pythonPath, cwd, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const existingEnvs = current.pythonEnvs ?? [];
      const envIndex = existingEnvs.findIndex((env) => env.name === envName);
      if (envIndex === -1) {
        throw new Error(`Python environment "${envName}" was not found in graph ${graphId}`);
      }

      const existingEnv = existingEnvs[envIndex];
      const nextEnvName = name ?? existingEnv.name;
      const nextEnv: PythonEnvironment = {
        name: nextEnvName,
        pythonPath: pythonPath ?? existingEnv.pythonPath,
        cwd: cwd ?? existingEnv.cwd,
      };

      const duplicateName = existingEnvs.some(
        (env, index) => index !== envIndex && env.name === nextEnv.name
      );
      if (duplicateName) {
        throw new Error(`Python environment "${nextEnv.name}" already exists in graph ${graphId}`);
      }

      const nextNodes =
        nextEnvName === envName
          ? current.nodes
          : current.nodes.map((node) =>
              node.config.pythonEnv === envName
                ? {
                    ...node,
                    config: {
                      ...node.config,
                      pythonEnv: nextEnvName,
                    },
                    version: ensureNodeVersion(node),
                  }
                : node
            );

      return {
        ...current,
        pythonEnvs: existingEnvs.map((env, index) => (index === envIndex ? nextEnv : env)),
        nodes: nextNodes,
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'graph_python_env_delete',
  {
    description:
      'Delete a graph Python environment by name and clear pythonEnv bindings from nodes that referenced it.',
    inputSchema: {
      graphId: z.string(),
      envName: z.string().trim().min(1),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, envName, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const existingEnvs = current.pythonEnvs ?? [];
      const hasEnv = existingEnvs.some((env) => env.name === envName);
      if (!hasEnv) {
        throw new Error(`Python environment "${envName}" was not found in graph ${graphId}`);
      }

      return {
        ...current,
        pythonEnvs: existingEnvs.filter((env) => env.name !== envName),
        nodes: current.nodes.map((node) =>
          node.config.pythonEnv === envName
            ? {
                ...node,
                config: {
                  ...node.config,
                  pythonEnv: undefined,
                },
                version: ensureNodeVersion(node),
              }
            : node
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_create',
  {
    description: 'Create a persistent drawing object with a draggable handle/title.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, name, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const drawingId = randomUUID();

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: [
        ...(current.drawings ?? []),
        {
          id: drawingId,
          name: name ?? `Drawing ${((current.drawings ?? []).length + 1)}`,
          position: {
            x: x ?? 0,
            y: y ?? 0,
          },
          paths: [],
        },
      ],
    }));

    return textResult({ graphId, drawingId, graph });
  }
);

server.registerTool(
  'drawing_add_path',
  {
    description: 'Append a path to an existing drawing object.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
      color: z.enum(['white', 'green', 'red']).optional(),
      thickness: z.number().positive().optional(),
      pathId: z.string().optional(),
      coordinateSpace: z.enum(['world', 'local']).optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    drawingId,
    points,
    color,
    thickness,
    pathId,
    coordinateSpace,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const drawing = (current.drawings ?? []).find((candidate) => candidate.id === drawingId);
      if (!drawing) {
        throw new Error(`Drawing ${drawingId} not found in graph ${graphId}`);
      }

      const localPoints = (coordinateSpace ?? 'world') === 'local'
        ? points
        : points.map((point) => ({
            x: point.x - drawing.position.x,
            y: point.y - drawing.position.y,
          }));

      return {
        ...current,
        drawings: (current.drawings ?? []).map((candidate) =>
          candidate.id === drawingId
            ? {
                ...candidate,
                paths: [
                  ...candidate.paths,
                  {
                    id: pathId ?? randomUUID(),
                    color: color ?? 'white',
                    thickness: thickness ?? 3,
                    points: localPoints,
                  },
                ],
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_move',
  {
    description: 'Move a drawing handle (and all of its paths) to a new world position.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      x: z.number(),
      y: z.number(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              position: { x, y },
            }
          : drawing
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_set_name',
  {
    description: 'Rename a drawing object.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).map((drawing) =>
        drawing.id === drawingId
          ? {
              ...drawing,
              name,
            }
          : drawing
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'drawing_delete',
  {
    description: 'Delete a drawing object and all stored paths.',
    inputSchema: {
      graphId: z.string(),
      drawingId: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, drawingId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      drawings: (current.drawings ?? []).filter((drawing) => drawing.id !== drawingId),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_add_inline',
  {
    description: 'Add an inline code node to a graph.',
    inputSchema: {
      graphId: z.string(),
      name: z.string().optional(),
      x: z.number(),
      y: z.number(),
      inputNames: z.array(z.string()).optional(),
      outputNames: z.array(z.string()).optional(),
      code: z.string().optional(),
      runtime: z.string().optional(),
      pythonEnv: z.string().optional(),
      autoRecompute: z.boolean().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    name,
    x,
    y,
    inputNames,
    outputNames,
    code,
    runtime,
    pythonEnv,
    autoRecompute,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const nodeId = randomUUID();
    const nowVersion = `${Date.now()}-${nodeId}`;

    const inputs = (inputNames && inputNames.length > 0 ? inputNames : ['input']).map(
      (portName) => {
        assertValidPortName(portName, 'input');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      }
    );

    const outputs = (outputNames && outputNames.length > 0 ? outputNames : ['output']).map(
      (portName) => {
        assertValidPortName(portName, 'output');
        return {
          name: portName,
          schema: { type: 'object' as const },
        };
      }
    );

    const node: GraphNode = {
      id: nodeId,
      type: 'inline_code',
      position: { x, y },
      metadata: {
        name: name ?? 'Inline Code',
        inputs,
        outputs,
      },
      config: {
        type: 'inline_code',
        runtime: runtime ?? 'javascript_vm',
        ...(pythonEnv ? { pythonEnv } : {}),
        code: code ?? 'outputs.output = inputs.input;',
        config: {
          autoRecompute: autoRecompute ?? false,
        },
      },
      version: nowVersion,
    };

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: [...current.nodes, node],
    }));

    return textResult({ graphId, nodeId, graph });
  }
);

server.registerTool(
  'node_move',
  {
    description: 'Move a node to a new canvas position.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      x: z.number(),
      y: z.number(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, x, y, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              position: { x, y },
            }
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_set_name',
  {
    description: 'Rename a node/card.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      name: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, name, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                name,
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_set_code',
  {
    description: 'Update inline code for a node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      code: z.string(),
      runtime: z.string().optional(),
      pythonEnv: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, code, runtime, pythonEnv, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                code,
                ...(runtime ? { runtime } : {}),
                ...(pythonEnv ? { pythonEnv } : {}),
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_set_auto_recompute',
  {
    description: 'Enable/disable auto recompute for a node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      enabled: z.boolean(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, enabled, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              config: {
                ...node.config,
                config: {
                  ...(node.config.config ?? {}),
                  autoRecompute: enabled,
                },
              },
              version: ensureNodeVersion(node),
            }
          : node
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'node_add_input',
  {
    description: 'Add an input port to a node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      inputName: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, inputName, backendUrl }) => {
    assertValidPortName(inputName, 'input');
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      if (node.metadata.inputs.some((input) => input.name === inputName)) {
        throw new Error(`Input port ${inputName} already exists on node ${nodeId}`);
      }

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: [
                    ...candidate.metadata.inputs,
                    {
                      name: inputName,
                      schema: { type: 'object' },
                    },
                  ],
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_delete_input',
  {
    description: 'Delete an input port and remove connections targeting it.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      inputName: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, inputName, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      if (!node.metadata.inputs.some((input) => input.name === inputName)) {
        throw new Error(`Input port ${inputName} was not found on node ${nodeId}`);
      }

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.filter((input) => input.name !== inputName),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: current.connections.filter(
          (connection) =>
            !(connection.targetNodeId === nodeId && connection.targetPort === inputName)
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_move_input',
  {
    description: 'Reorder an input port by moving it up/down in the inputs list.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      inputName: z.string(),
      direction: z.enum(['up', 'down']),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, inputName, direction, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      const inputs = [...node.metadata.inputs];
      const index = inputs.findIndex((input) => input.name === inputName);
      if (index === -1) {
        throw new Error(`Input port ${inputName} was not found on node ${nodeId}`);
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= inputs.length) {
        return current;
      }

      [inputs[index], inputs[targetIndex]] = [inputs[targetIndex], inputs[index]];

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs,
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_rename_input',
  {
    description: 'Rename an input port and retarget existing inbound connections.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      oldName: z.string(),
      newName: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, oldName, newName, backendUrl }) => {
    assertValidPortName(newName, 'input');
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const node = getNode(current, nodeId);
      if (!node.metadata.inputs.some((input) => input.name === oldName)) {
        throw new Error(`Input port ${oldName} was not found on node ${nodeId}`);
      }
      if (node.metadata.inputs.some((input) => input.name === newName)) {
        throw new Error(`Input port ${newName} already exists on node ${nodeId}`);
      }

      return {
        ...current,
        nodes: current.nodes.map((candidate) =>
          candidate.id === nodeId
            ? {
                ...candidate,
                metadata: {
                  ...candidate.metadata,
                  inputs: candidate.metadata.inputs.map((input) =>
                    input.name === oldName
                      ? {
                          ...input,
                          name: newName,
                        }
                      : input
                  ),
                },
                version: ensureNodeVersion(candidate),
              }
            : candidate
        ),
        connections: current.connections.map((connection) =>
          connection.targetNodeId === nodeId && connection.targetPort === oldName
            ? {
                ...connection,
                targetPort: newName,
              }
            : connection
        ),
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'node_delete',
  {
    description: 'Delete a node and all connected edges.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      connections: current.connections.filter(
        (connection) =>
          connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId
      ),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'connection_add',
  {
    description: 'Create a connection between two ports.',
    inputSchema: {
      graphId: z.string(),
      sourceNodeId: z.string(),
      sourcePort: z.string(),
      targetNodeId: z.string(),
      targetPort: z.string(),
      connectionId: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({
    graphId,
    sourceNodeId,
    sourcePort,
    targetNodeId,
    targetPort,
    connectionId,
    backendUrl,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);

    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => {
      const sourceNode = getNode(current, sourceNodeId);
      const targetNode = getNode(current, targetNodeId);
      if (!sourceNode.metadata.outputs.some((output) => output.name === sourcePort)) {
        throw new Error(`Source port ${sourcePort} not found on node ${sourceNodeId}`);
      }
      if (!targetNode.metadata.inputs.some((input) => input.name === targetPort)) {
        throw new Error(`Target port ${targetPort} not found on node ${targetNodeId}`);
      }

      const duplicate = current.connections.some(
        (connection) =>
          connection.sourceNodeId === sourceNodeId &&
          connection.sourcePort === sourcePort &&
          connection.targetNodeId === targetNodeId &&
          connection.targetPort === targetPort
      );
      if (duplicate) {
        return current;
      }

      return {
        ...current,
        connections: [
          ...current.connections,
          {
            id: connectionId ?? randomUUID(),
            sourceNodeId,
            sourcePort,
            targetNodeId,
            targetPort,
          },
        ],
      };
    });

    return textResult(graph);
  }
);

server.registerTool(
  'connection_delete',
  {
    description: 'Delete a connection by id.',
    inputSchema: {
      graphId: z.string(),
      connectionId: z.string(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, connectionId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graph = await updateGraph(resolvedBackendUrl, graphId, (current) => ({
      ...current,
      connections: current.connections.filter((connection) => connection.id !== connectionId),
    }));

    return textResult(graph);
  }
);

server.registerTool(
  'graph_compute',
  {
    description: 'Compute full graph or a selected node.',
    inputSchema: {
      graphId: z.string(),
      nodeId: z.string().optional(),
      backendUrl: z.string().optional(),
    },
  },
  async ({ graphId, nodeId, backendUrl }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const result = await requestJson<unknown>(
      resolvedBackendUrl,
      `/api/graphs/${encodeURIComponent(graphId)}/compute`,
      {
        method: 'POST',
        body: JSON.stringify(nodeId ? { nodeId } : {}),
      }
    );

    return textResult(result);
  }
);

server.registerTool(
  'graph_screenshot_region',
  {
    description:
      'Render only graph content in an internal Playwright page and capture a fixed-size bitmap for a world-coordinate rectangle.',
    inputSchema: {
      graphId: z.string().optional(),
      graph: z.unknown().optional(),
      backendUrl: z.string().optional(),
      regionX: z.number(),
      regionY: z.number(),
      regionWidth: z.number().positive(),
      regionHeight: z.number().positive(),
      bitmapWidth: z.number().int().positive(),
      bitmapHeight: z.number().int().positive(),
      outputPath: z.string().optional(),
      includeBase64: z.boolean().optional(),
    },
  },
  async ({
    graphId,
    graph,
    backendUrl,
    regionX,
    regionY,
    regionWidth,
    regionHeight,
    bitmapWidth,
    bitmapHeight,
    outputPath,
    includeBase64,
  }) => {
    const resolvedBackendUrl = resolveBackendUrl(backendUrl);
    const graphData = graph
      ? normalizeGraph(graph as Graph)
      : graphId
        ? await getGraph(resolvedBackendUrl, graphId)
        : normalizeGraph(await requestJson<Graph>(resolvedBackendUrl, '/api/graphs/latest'));
    const nodeNumbers = getStableNodeNumbers(graphData);

    const result = await renderGraphRegionScreenshot({
      graph: graphData,
      nodeNumbers,
      region: {
        x: regionX,
        y: regionY,
        width: regionWidth,
        height: regionHeight,
      },
      bitmap: {
        width: bitmapWidth,
        height: bitmapHeight,
      },
      outputPath,
      includeBase64,
    });

    const content: Array<{
      type: 'text' | 'image';
      text?: string;
      mimeType?: string;
      data?: string;
    }> = [
      {
        type: 'text',
        text: JSON.stringify(
          {
            graphId: graphData.id,
            region: {
              x: regionX,
              y: regionY,
              width: regionWidth,
              height: regionHeight,
            },
            bitmap: {
              width: bitmapWidth,
              height: bitmapHeight,
            },
            nodeNumbers,
            outputPath: result.outputPath,
            bytes: result.bytes,
          },
          null,
          2
        ),
      },
    ];

    if (result.base64) {
      content.push({
        type: 'image',
        mimeType: 'image/png',
        data: result.base64,
      });
    }

    return { content };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
