import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { renderGraphRegionScreenshot } from '../src/index.ts';

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

function getPixel(image: PNG, x: number, y: number): Pixel {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const index = ((clampedY * image.width) + clampedX) * 4;
  return {
    r: image.data[index] ?? 0,
    g: image.data[index + 1] ?? 0,
    b: image.data[index + 2] ?? 0,
    a: image.data[index + 3] ?? 0,
  };
}

function createBaseGraph() {
  const now = Date.now();
  return {
    id: 'graph-screenshot-parity',
    name: 'Parity Graph',
    nodes: [] as Array<any>,
    connections: [] as Array<any>,
    canvasBackground: { mode: 'gradient', baseColor: '#1d437e' },
    connectionStroke: {
      foregroundColor: '#334155',
      backgroundColor: '#cbd5e1',
      foregroundWidth: 1,
      backgroundWidth: 2,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function createInlineNode(params: {
  id: string;
  x: number;
  y: number;
  inputs?: string[];
  outputs?: string[];
  cardWidth?: number;
  cardHeight?: number;
}) {
  return {
    id: params.id,
    type: 'inline_code',
    position: { x: params.x, y: params.y },
    metadata: {
      name: params.id,
      inputs: (params.inputs ?? []).map((name) => ({ name, schema: { type: 'number' } })),
      outputs: (params.outputs ?? []).map((name) => ({ name, schema: { type: 'number' } })),
    },
    config: {
      type: 'inline_code',
      code: 'outputs.output = 1;',
      runtime: 'javascript_vm',
      config: {
        ...(typeof params.cardWidth === 'number' ? { cardWidth: params.cardWidth } : {}),
        ...(typeof params.cardHeight === 'number' ? { cardHeight: params.cardHeight } : {}),
      },
    },
    version: `${params.id}-v1`,
  };
}

async function renderGraphToImage(graph: any, testName: string): Promise<PNG> {
  const outputDir = path.resolve(process.cwd(), 'tmp', 'mcp-screenshot-parity-tests');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `${testName}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
  );

  const result = await renderGraphRegionScreenshot({
    graph,
    nodeNumbers: {},
    region: {
      x: 0,
      y: 0,
      width: 500,
      height: 200,
    },
    bitmap: {
      width: 500,
      height: 200,
    },
    outputPath,
    includeBase64: true,
  });

  assert.ok(result.base64, 'Expected base64 payload from screenshot renderer.');
  const image = PNG.sync.read(Buffer.from(result.base64, 'base64'));
  await rm(outputPath, { force: true });
  return image;
}

test('graph screenshot renderer honors solid canvas background color', async () => {
  const graph = createBaseGraph();
  graph.canvasBackground = {
    mode: 'solid',
    baseColor: '#123456',
  };

  const image = await renderGraphToImage(graph, 'solid-background');
  const pixel = getPixel(image, 250, 100);
  assert.ok(pixel.r >= 0x10 && pixel.r <= 0x14, `Unexpected red channel: ${pixel.r}`);
  assert.ok(pixel.g >= 0x32 && pixel.g <= 0x36, `Unexpected green channel: ${pixel.g}`);
  assert.ok(pixel.b >= 0x54 && pixel.b <= 0x58, `Unexpected blue channel: ${pixel.b}`);
  assert.equal(pixel.a, 255);
});

test('graph screenshot renderer applies graph connection stroke colors/widths', async () => {
  const graph = createBaseGraph();
  graph.canvasBackground = {
    mode: 'solid',
    baseColor: '#ffffff',
  };
  graph.connectionStroke = {
    foregroundColor: '#ff0000',
    backgroundColor: '#00ff00',
    foregroundWidth: 6,
    backgroundWidth: 12,
  };

  graph.nodes.push(
    createInlineNode({
      id: 'source',
      x: 40,
      y: 40,
      outputs: ['value'],
    }),
    createInlineNode({
      id: 'target',
      x: 320,
      y: 40,
      inputs: ['input'],
    })
  );
  graph.connections.push({
    id: 'c1',
    sourceNodeId: 'source',
    sourcePort: 'value',
    targetNodeId: 'target',
    targetPort: 'input',
  });

  const image = await renderGraphToImage(graph, 'connection-stroke');
  const center = getPixel(image, 290, 89);
  const halo = getPixel(image, 290, 94);

  assert.ok(center.r > 170, `Expected red foreground center, got r=${center.r}`);
  assert.ok(center.g < 120, `Expected red foreground center, got g=${center.g}`);
  assert.ok(center.b < 120, `Expected red foreground center, got b=${center.b}`);

  assert.ok(halo.g > 130, `Expected green background halo, got g=${halo.g}`);
  assert.ok(halo.r < 170, `Expected green background halo, got r=${halo.r}`);
});

test('graph screenshot renderer respects persisted node card width', async () => {
  const graph = createBaseGraph();
  graph.canvasBackground = {
    mode: 'solid',
    baseColor: '#000000',
  };
  graph.nodes.push(
    createInlineNode({
      id: 'wide',
      x: 40,
      y: 40,
      cardWidth: 360,
      cardHeight: 96,
    })
  );

  const image = await renderGraphToImage(graph, 'card-width');
  const insideExpandedCard = getPixel(image, 340, 60);

  assert.ok(
    insideExpandedCard.r > 140 && insideExpandedCard.g > 140 && insideExpandedCard.b > 140,
    `Expected light card pixel inside widened card, got rgb(${insideExpandedCard.r},${insideExpandedCard.g},${insideExpandedCard.b}).`
  );
});
