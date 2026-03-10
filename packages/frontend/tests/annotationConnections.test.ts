import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeType, type Connection } from '../src/types.ts';
import {
  areConnectionAnchorsEqual,
  buildGraphNodeMap,
  isAnnotationConnection,
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
  const nodes = [
    {
      id: 'annotation',
      type: NodeType.ANNOTATION,
    },
    {
      id: 'compute',
      type: NodeType.INLINE_CODE,
    },
  ] as const;
  const nodeById = buildGraphNodeMap(nodes as any);

  const annotationConnection: Connection = {
    id: 'annotation-edge',
    sourceNodeId: 'annotation',
    sourcePort: '__annotation__',
    sourceAnchor: { side: 'bottom', offset: 0.25 },
    targetNodeId: 'compute',
    targetPort: 'input',
  };

  assert.equal(isAnnotationConnection(annotationConnection, nodeById), true);
  assert.equal(
    areConnectionAnchorsEqual(annotationConnection.sourceAnchor, { side: 'bottom', offset: 0.25 }),
    true
  );
  assert.equal(
    areConnectionAnchorsEqual(annotationConnection.sourceAnchor, { side: 'bottom', offset: 0.5 }),
    false
  );
});
