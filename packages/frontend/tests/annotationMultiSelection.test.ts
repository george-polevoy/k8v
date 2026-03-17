import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeType, type Graph, type GraphNode } from '../src/types.ts';
import {
  buildSharedAnnotationTextStyleNodes,
  resolveSharedAnnotationTextStyleSelectionState,
} from '../src/utils/annotationMultiSelection.ts';

function createAnnotationNode(
  id: string,
  name: string,
  overrides?: {
    fontColor?: string;
    fontSize?: number;
  }
): GraphNode {
  return {
    id,
    type: NodeType.ANNOTATION,
    position: { x: 100, y: 120 },
    metadata: {
      name,
      inputs: [],
      outputs: [],
    },
    config: {
      type: NodeType.ANNOTATION,
      config: {
        text: `${name} note`,
        backgroundColor: '#fef3c7',
        borderColor: '#334155',
        fontColor: overrides?.fontColor ?? '#1f2937',
        fontSize: overrides?.fontSize ?? 14,
      },
    },
    version: `${id}-v1`,
  };
}

function createNumericNode(id: string): GraphNode {
  return {
    id,
    type: NodeType.NUMERIC_INPUT,
    position: { x: 240, y: 180 },
    metadata: {
      name: 'Number',
      inputs: [],
      outputs: [{ name: 'value', schema: { type: 'number' } }],
    },
    config: {
      type: NodeType.NUMERIC_INPUT,
      config: {
        value: 1,
        min: 0,
        max: 10,
        step: 1,
      },
    },
    version: `${id}-v1`,
  };
}

function createGraph(nodes: GraphNode[]): Graph {
  return {
    id: 'graph-1',
    name: 'Graph 1',
    revision: 1,
    nodes,
    connections: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

test('resolveSharedAnnotationTextStyleSelectionState reports mixed annotation text styles', () => {
  const left = createAnnotationNode('annotation-left', 'Left', {
    fontColor: '#1f2937',
    fontSize: 14,
  });
  const right = createAnnotationNode('annotation-right', 'Right', {
    fontColor: '#ef4444',
    fontSize: 24,
  });

  assert.deepEqual(
    resolveSharedAnnotationTextStyleSelectionState([left, right]),
    {
      isApplicable: true,
      firstFontColor: '#1f2937',
      firstFontSize: 14,
      hasMixedFontColor: true,
      hasMixedFontSize: true,
    }
  );
});

test('resolveSharedAnnotationTextStyleSelectionState ignores mixed-type selections', () => {
  const annotation = createAnnotationNode('annotation-1', 'Left');
  const numeric = createNumericNode('numeric-1');

  assert.deepEqual(
    resolveSharedAnnotationTextStyleSelectionState([annotation, numeric]),
    {
      isApplicable: false,
      firstFontColor: '#1f2937',
      firstFontSize: 14,
      hasMixedFontColor: false,
      hasMixedFontSize: false,
    }
  );
});

test('buildSharedAnnotationTextStyleNodes updates only the selected annotation cards', () => {
  const left = createAnnotationNode('annotation-left', 'Left', {
    fontColor: '#1f2937',
    fontSize: 14,
  });
  const right = createAnnotationNode('annotation-right', 'Right', {
    fontColor: '#ef4444',
    fontSize: 24,
  });
  const untouchedAnnotation = createAnnotationNode('annotation-other', 'Other', {
    fontColor: '#0f172a',
    fontSize: 18,
  });
  const numeric = createNumericNode('numeric-1');
  const graph = createGraph([left, right, untouchedAnnotation, numeric]);

  const result = buildSharedAnnotationTextStyleNodes(graph, [left, right], {
    fontColor: '#22c55e',
    fontSize: '28',
  });

  assert.equal(result.didChange, true);
  assert.equal(result.nextFontColor, '#22c55e');
  assert.equal(result.nextFontSize, 28);

  const updatedLeft = result.nodes.find((node) => node.id === left.id);
  const updatedRight = result.nodes.find((node) => node.id === right.id);
  const untouchedOther = result.nodes.find((node) => node.id === untouchedAnnotation.id);
  const untouchedNumeric = result.nodes.find((node) => node.id === numeric.id);

  assert.equal(updatedLeft?.config.config?.fontColor, '#22c55e');
  assert.equal(updatedLeft?.config.config?.fontSize, 28);
  assert.notEqual(updatedLeft?.version, left.version);

  assert.equal(updatedRight?.config.config?.fontColor, '#22c55e');
  assert.equal(updatedRight?.config.config?.fontSize, 28);
  assert.notEqual(updatedRight?.version, right.version);

  assert.equal(untouchedOther?.config.config?.fontColor, '#0f172a');
  assert.equal(untouchedOther?.config.config?.fontSize, 18);
  assert.equal(untouchedOther?.version, untouchedAnnotation.version);

  assert.equal(untouchedNumeric?.config.type, NodeType.NUMERIC_INPUT);
  assert.equal(untouchedNumeric?.version, numeric.version);
});

test('buildSharedAnnotationTextStyleNodes ignores blank shared font-size edits', () => {
  const left = createAnnotationNode('annotation-left', 'Left');
  const right = createAnnotationNode('annotation-right', 'Right', {
    fontSize: 18,
  });
  const graph = createGraph([left, right]);

  const result = buildSharedAnnotationTextStyleNodes(graph, [left, right], {
    fontSize: '  ',
  });

  assert.equal(result.didChange, false);
  assert.equal(result.nextFontSize, undefined);
  assert.equal(result.nodes[0]?.config.config?.fontSize, 14);
  assert.equal(result.nodes[1]?.config.config?.fontSize, 18);
});
