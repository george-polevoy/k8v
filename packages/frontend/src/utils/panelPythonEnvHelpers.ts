import { Graph, GraphNode, PythonEnvironment } from '../types';
import { getNextPythonEnvName } from './panelGraphHelpers';

export type PythonEnvDraftField = keyof PythonEnvironment;

export const PYTHON_ENV_REQUIRED_FIELDS_ERROR =
  'Each Python env requires name, python path, and working directory.';
export const PYTHON_ENV_UNIQUE_NAMES_ERROR =
  'Python env names must be unique within a graph.';

export interface PythonEnvCommitPlan {
  normalizedEnvs: PythonEnvironment[];
  nextNodes: GraphNode[];
}

export type PythonEnvCommitResolution =
  | {
      ok: false;
      error: string;
    }
  | ({
      ok: true;
    } & PythonEnvCommitPlan);

export function updatePythonEnvDraftField(
  drafts: PythonEnvironment[],
  index: number,
  field: PythonEnvDraftField,
  value: string
): PythonEnvironment[] {
  return drafts.map((env, envIndex) =>
    envIndex === index
      ? {
          ...env,
          [field]: value,
        }
      : env
  );
}

export function addPythonEnvDraft(drafts: PythonEnvironment[]): PythonEnvironment[] {
  return [
    ...drafts,
    {
      name: getNextPythonEnvName(drafts),
      pythonPath: '',
      cwd: '',
    },
  ];
}

export function deletePythonEnvDraft(
  drafts: PythonEnvironment[],
  index: number
): PythonEnvironment[] {
  return drafts.filter((_, envIndex) => envIndex !== index);
}

function normalizePythonEnvDrafts(drafts: PythonEnvironment[]): PythonEnvironment[] {
  return drafts.map((env) => ({
    name: env.name.trim(),
    pythonPath: env.pythonPath.trim(),
    cwd: env.cwd.trim(),
  }));
}

function hasAllRequiredPythonEnvFields(envs: PythonEnvironment[]): boolean {
  return envs.every((env) => Boolean(env.name && env.pythonPath && env.cwd));
}

function hasUniquePythonEnvNames(envs: PythonEnvironment[]): boolean {
  const uniqueNames = new Set(envs.map((env) => env.name));
  return uniqueNames.size === envs.length;
}

function removeInvalidNodePythonEnvReferences(
  nodes: GraphNode[],
  validEnvNames: Set<string>
): GraphNode[] {
  return nodes.map((node) => {
    if (node.type !== 'inline_code') {
      return node;
    }

    if (!node.config.pythonEnv || validEnvNames.has(node.config.pythonEnv)) {
      return node;
    }

    return {
      ...node,
      config: {
        ...node.config,
        pythonEnv: undefined,
      },
      version: `${Date.now()}-${node.id}`,
    };
  });
}

export function buildPythonEnvCommitPlan(
  graph: Pick<Graph, 'nodes'>,
  drafts: PythonEnvironment[]
): PythonEnvCommitResolution {
  const normalizedEnvs = normalizePythonEnvDrafts(drafts);
  if (!hasAllRequiredPythonEnvFields(normalizedEnvs)) {
    return {
      ok: false,
      error: PYTHON_ENV_REQUIRED_FIELDS_ERROR,
    };
  }

  if (!hasUniquePythonEnvNames(normalizedEnvs)) {
    return {
      ok: false,
      error: PYTHON_ENV_UNIQUE_NAMES_ERROR,
    };
  }

  const envNames = new Set(normalizedEnvs.map((env) => env.name));
  return {
    ok: true,
    normalizedEnvs,
    nextNodes: removeInvalidNodePythonEnvReferences(graph.nodes, envNames),
  };
}
