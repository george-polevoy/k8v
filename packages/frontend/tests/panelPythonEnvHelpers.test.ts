import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphNode, NodeType, PythonEnvironment } from '../src/types.ts';
import {
  addPythonEnvDraft,
  buildPythonEnvCommitPlan,
  deletePythonEnvDraft,
  PYTHON_ENV_REQUIRED_FIELDS_ERROR,
  PYTHON_ENV_UNIQUE_NAMES_ERROR,
  updatePythonEnvDraftField,
} from '../src/utils/panelPythonEnvHelpers.ts';

function createInlineNode(id: string, pythonEnv?: string): GraphNode {
  return {
    id,
    type: NodeType.INLINE_CODE,
    position: { x: 0, y: 0 },
    metadata: {
      name: id,
      inputs: [],
      outputs: [],
    },
    config: {
      type: NodeType.INLINE_CODE,
      pythonEnv,
      config: {},
    },
    version: `${id}-v1`,
  };
}

test('update/add/delete helpers mutate python env drafts as expected', () => {
  const initial: PythonEnvironment[] = [
    { name: 'python_env_1', pythonPath: '/usr/bin/python3', cwd: '/tmp/a' },
  ];

  const updated = updatePythonEnvDraftField(initial, 0, 'cwd', '/tmp/b');
  assert.equal(updated[0]?.cwd, '/tmp/b');

  const withAdded = addPythonEnvDraft(updated);
  assert.equal(withAdded.length, 2);
  assert.equal(withAdded[1]?.name, 'python_env_2');
  assert.equal(withAdded[1]?.pythonPath, '');
  assert.equal(withAdded[1]?.cwd, '');

  const withDeleted = deletePythonEnvDraft(withAdded, 0);
  assert.equal(withDeleted.length, 1);
  assert.equal(withDeleted[0]?.name, 'python_env_2');
});

test('buildPythonEnvCommitPlan trims fields and clears invalid node python env references', () => {
  const graph = {
    nodes: [
      createInlineNode('keep', 'python_env_1'),
      createInlineNode('clear', 'missing_env'),
      createInlineNode('empty'),
    ],
  };

  const resolution = buildPythonEnvCommitPlan(graph, [
    { name: '  python_env_1  ', pythonPath: ' /usr/bin/python3 ', cwd: ' /tmp/work ' },
  ]);

  assert.equal(resolution.ok, true);
  if (!resolution.ok) {
    assert.fail('Expected successful python env commit resolution.');
  }

  assert.deepEqual(resolution.normalizedEnvs, [
    { name: 'python_env_1', pythonPath: '/usr/bin/python3', cwd: '/tmp/work' },
  ]);
  assert.equal(resolution.nextNodes[0]?.config.pythonEnv, 'python_env_1');
  assert.equal(resolution.nextNodes[2]?.config.pythonEnv, undefined);
  assert.equal(resolution.nextNodes[1]?.config.pythonEnv, undefined);
  assert.match(resolution.nextNodes[1]?.version ?? '', /^\d+-clear$/);
});

test('buildPythonEnvCommitPlan returns required-field validation message', () => {
  const resolution = buildPythonEnvCommitPlan(
    { nodes: [createInlineNode('n1')] },
    [{ name: 'python_env_1', pythonPath: '', cwd: '/tmp/work' }]
  );

  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    assert.fail('Expected required-field validation error.');
  }
  assert.equal(resolution.error, PYTHON_ENV_REQUIRED_FIELDS_ERROR);
});

test('buildPythonEnvCommitPlan returns unique-name validation message', () => {
  const resolution = buildPythonEnvCommitPlan(
    { nodes: [createInlineNode('n1')] },
    [
      { name: 'python_env_1', pythonPath: '/usr/bin/python3', cwd: '/tmp/a' },
      { name: 'python_env_1', pythonPath: '/usr/bin/python3', cwd: '/tmp/b' },
    ]
  );

  assert.equal(resolution.ok, false);
  if (resolution.ok) {
    assert.fail('Expected unique-name validation error.');
  }
  assert.equal(resolution.error, PYTHON_ENV_UNIQUE_NAMES_ERROR);
});
