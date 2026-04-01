import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeType, type GraphNode } from '../src/types.ts';
import {
  DEFAULT_NODE_CARD_BACKGROUND_COLOR,
  DEFAULT_NODE_CARD_BORDER_COLOR,
  normalizeNodeCardAppearanceConfig,
  resolveNodeCardAppearance,
} from '../src/utils/nodeCardAppearance.ts';

function createNode(overrides?: Partial<GraphNode>): GraphNode {
  return {
    id: 'node-1',
    type: NodeType.NUMERIC_INPUT,
    position: { x: 120, y: 140 },
    metadata: {
      name: 'Node 1',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      dragDebounceSeconds: 0.1,
    },
    version: '1',
    ...overrides,
  };
}

test('normalizeNodeCardAppearanceConfig falls back to default card colors', () => {
  assert.deepEqual(
    normalizeNodeCardAppearanceConfig(undefined),
    {
      backgroundColor: DEFAULT_NODE_CARD_BACKGROUND_COLOR,
      borderColor: DEFAULT_NODE_CARD_BORDER_COLOR,
    }
  );
});

test('resolveNodeCardAppearance uses generic node card colors when present', () => {
  const node = createNode({
    config: {
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      dragDebounceSeconds: 0.1,
      backgroundColor: 'rgba(59, 130, 246, 0.4)',
      borderColor: '#0f172a',
    },
  });

  assert.deepEqual(
    resolveNodeCardAppearance(node),
    {
      backgroundColor: 'rgba(59, 130, 246, 0.4)',
      borderColor: '#0f172a',
    }
  );
});

test('resolveNodeCardAppearance reuses annotation card colors for annotation nodes', () => {
  const node = createNode({
    type: NodeType.ANNOTATION,
    config: {
      text: 'Hello',
      backgroundColor: 'rgba(16, 185, 129, 0.5)',
      borderColor: '#ef4444',
      fontColor: '#ffffff',
      fontSize: 16,
      cardWidth: 320,
      cardHeight: 200,
    },
  });

  assert.deepEqual(
    resolveNodeCardAppearance(node),
    {
      backgroundColor: 'rgba(16, 185, 129, 0.5)',
      borderColor: '#ef4444',
    }
  );
});
