import test from 'node:test';
import assert from 'node:assert/strict';
import { ANNOTATION_CONNECTION_PORT, NodeType, type Connection } from '../src/types.ts';
import { createsCycle } from '../src/components/canvasGraphRules.ts';
import {
  areConnectionAnchorsEqual,
  isPresentationArrowConnection,
  resolveAnnotationEdgeDropTarget,
  resolveConnectionAnchorPoint,
} from '../src/utils/annotationConnections.ts';

test('resolveAnnotationEdgeDropTarget snaps to the nearest edge and normalizes offsets', () => {
  const nodePosition = { x: 100, y: 200 };
  const width = 320;
  const height = 180;

  const bottomTarget = resolveAnnotationEdgeDropTarget(
    nodePosition,
    width,
    height,
    { x: 180, y: 381 },
    12
  );
  assert.ok(bottomTarget, 'Expected bottom edge to be hittable');
  assert.equal(bottomTarget.anchor.side, 'bottom');
  assert.ok(Math.abs(bottomTarget.anchor.offset - 0.25) < 0.001);
  assert.deepEqual(
    bottomTarget.point,
    resolveConnectionAnchorPoint(nodePosition, width, height, bottomTarget.anchor)
  );

  const leftTarget = resolveAnnotationEdgeDropTarget(
    nodePosition,
    width,
    height,
    { x: 98, y: 245 },
    12
  );
  assert.ok(leftTarget, 'Expected left edge to be hittable');
  assert.equal(leftTarget.anchor.side, 'left');
  assert.ok(Math.abs(leftTarget.anchor.offset - 0.25) < 0.01);
});

test('annotation connection helpers treat annotation-linked edges as presentation-only', () => {
  const annotationConnection: Connection = {
    id: 'annotation-edge',
    sourceNodeId: 'annotation',
    sourcePort: '__annotation__',
    sourceAnchor: { side: 'bottom', offset: 0.25 },
    targetNodeId: 'compute',
    targetPort: 'input',
  };

  assert.equal(isPresentationArrowConnection(annotationConnection), true);
  assert.equal(
    areConnectionAnchorsEqual(annotationConnection.sourceAnchor, { side: 'bottom', offset: 0.25 }),
    true
  );
  assert.equal(
    areConnectionAnchorsEqual(annotationConnection.sourceAnchor, { side: 'bottom', offset: 0.5 }),
    false
  );
});

test('presentation connection helpers classify generic card-edge arrows separately from data connections', () => {
  const presentationConnection: Connection = {
    id: 'presentation-edge',
    sourceNodeId: 'source',
    sourcePort: ANNOTATION_CONNECTION_PORT,
    sourceAnchor: { side: 'right', offset: 0.5 },
    targetNodeId: 'target',
    targetPort: ANNOTATION_CONNECTION_PORT,
    targetAnchor: { side: 'left', offset: 0.5 },
  };
  const dataConnection: Connection = {
    id: 'data-edge',
    sourceNodeId: 'source',
    sourcePort: 'output',
    targetNodeId: 'target',
    targetPort: 'input',
  };

  assert.equal(isPresentationArrowConnection(presentationConnection), true);
  assert.equal(isPresentationArrowConnection(dataConnection), false);
});

test('frontend cycle checks ignore existing presentation arrows between the same nodes', () => {
  const nodes = [
    {
      id: 'source',
      type: NodeType.INLINE_CODE,
      metadata: { inputs: [], outputs: [], name: 'Source' },
    },
    {
      id: 'target',
      type: NodeType.INLINE_CODE,
      metadata: { inputs: [], outputs: [], name: 'Target' },
    },
  ] as any;

  const presentationConnection: Connection = {
    id: 'presentation-edge',
    sourceNodeId: 'target',
    sourcePort: ANNOTATION_CONNECTION_PORT,
    sourceAnchor: { side: 'left', offset: 0.5 },
    targetNodeId: 'source',
    targetPort: ANNOTATION_CONNECTION_PORT,
    targetAnchor: { side: 'right', offset: 0.5 },
  };

  assert.equal(
    createsCycle(nodes, 'source', 'target', [presentationConnection]),
    false
  );
});
