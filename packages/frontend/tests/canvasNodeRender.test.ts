import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeType, type GraphNode, type GraphicsArtifact } from '../src/types.ts';
import {
  resolveGraphicsProjectionPlan,
  resolveNodeRenderFrame,
  resolveNodeRenderTargetPosition,
  type ProjectionNodeVisualStateLike,
  type WorldBounds,
} from '../src/utils/canvasNodeRender.ts';

function createGraphNode(): GraphNode {
  return {
    id: 'node-1',
    type: NodeType.INLINE_CODE,
    position: { x: 10, y: 20 },
    metadata: {
      name: 'Node',
      inputs: [],
      outputs: [],
    },
    config: {
      code: 'outputs.output = 1;',
    },
    version: '1',
  };
}

function createGraphicsArtifact(): GraphicsArtifact {
  return {
    id: 'gfx-1',
    mimeType: 'image/png',
    levels: [
      { level: 0, width: 200, height: 100, pixelCount: 20_000 },
      { level: 1, width: 100, height: 50, pixelCount: 10_000 },
      { level: 2, width: 50, height: 25, pixelCount: 5_000 },
    ],
  };
}

test('resolveNodeRenderTargetPosition prefers matching drag state coordinates', () => {
  const node = createGraphNode();
  const position = resolveNodeRenderTargetPosition(node, {
    nodeId: node.id,
    currentX: 44,
    currentY: 55,
  });

  assert.deepEqual(position, { x: 44, y: 55 });
});

test('resolveNodeRenderTargetPosition falls back to draft then node position', () => {
  const node = createGraphNode();

  assert.deepEqual(
    resolveNodeRenderTargetPosition(node, null, { x: 33, y: 66 }),
    { x: 33, y: 66 }
  );
  assert.deepEqual(
    resolveNodeRenderTargetPosition(node, null),
    { x: 10, y: 20 }
  );
});

test('resolveNodeRenderFrame interpolates transition position and size', () => {
  const node = createGraphNode();
  const fromState: ProjectionNodeVisualStateLike = {
    position: { x: 0, y: 0 },
    width: 80,
    height: 50,
  };
  const toState: ProjectionNodeVisualStateLike = {
    position: { x: 100, y: 50 },
    width: 180,
    height: 110,
  };

  const frame = resolveNodeRenderFrame({
    node,
    dragState: null,
    draftPosition: { x: 500, y: 500 },
    targetWidth: 120,
    targetHeight: 80,
    minWidth: 60,
    minHeight: 40,
    fromTransitionState: fromState,
    toTransitionState: toState,
    transitionEasedProgress: 0.5,
  });

  assert.deepEqual(frame.position, { x: 50, y: 25 });
  assert.equal(frame.width, 130);
  assert.equal(frame.height, 80);
});

test('resolveNodeRenderFrame bypasses transition interpolation while dragging', () => {
  const node = createGraphNode();
  const frame = resolveNodeRenderFrame({
    node,
    dragState: {
      nodeId: node.id,
      currentX: 77,
      currentY: 88,
    },
    draftPosition: { x: 500, y: 500 },
    targetWidth: 140,
    targetHeight: 95,
    minWidth: 60,
    minHeight: 40,
    fromTransitionState: {
      position: { x: 0, y: 0 },
      width: 80,
      height: 50,
    },
    toTransitionState: {
      position: { x: 100, y: 50 },
      width: 180,
      height: 110,
    },
    transitionEasedProgress: 0.5,
  });

  assert.deepEqual(frame.position, { x: 77, y: 88 });
  assert.equal(frame.width, 140);
  assert.equal(frame.height, 95);
});

test('resolveGraphicsProjectionPlan computes viewport-gated load plan and mip debug values', () => {
  const graphicsOutput = createGraphicsArtifact();
  const viewportWorldBounds: WorldBounds = {
    minX: 0,
    minY: 0,
    maxX: 200,
    maxY: 200,
  };

  const plan = resolveGraphicsProjectionPlan({
    graphicsOutput,
    shouldProjectGraphics: true,
    nodePosition: { x: 10, y: 20 },
    nodeWidth: 100,
    nodeHeight: 80,
    viewportScale: 1,
    pixelRatio: 1,
    canEvaluateViewportGraphics: true,
    viewportWorldBounds,
    canReloadProjectedGraphics: true,
    fallbackAspectRatio: 0.6,
  });

  assert.equal(plan.projectedWidthOnScreen, 100);
  assert.equal(plan.estimatedMaxPixels, 5000);
  assert.equal(plan.stableMaxPixels, 10_000);
  assert.equal(plan.selectedLevel, 1);
  assert.equal(plan.selectedLevelPixels, 10_000);
  assert.equal(plan.expectedProjectedGraphicsHeight, 50);
  assert.equal(plan.shouldLoadProjectedGraphicsByViewport, true);
  assert.equal(plan.canReloadProjectedGraphics, true);
  assert.equal(plan.shouldLoadProjectedGraphics, true);
});

test('resolveGraphicsProjectionPlan blocks load during projection transition', () => {
  const plan = resolveGraphicsProjectionPlan({
    graphicsOutput: createGraphicsArtifact(),
    shouldProjectGraphics: true,
    nodePosition: { x: 10, y: 20 },
    nodeWidth: 100,
    nodeHeight: 80,
    viewportScale: 1,
    pixelRatio: 1,
    canEvaluateViewportGraphics: true,
    viewportWorldBounds: {
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 200,
    },
    canReloadProjectedGraphics: false,
    fallbackAspectRatio: 0.6,
  });

  assert.equal(plan.shouldLoadProjectedGraphicsByViewport, true);
  assert.equal(plan.shouldLoadProjectedGraphics, false);
});
