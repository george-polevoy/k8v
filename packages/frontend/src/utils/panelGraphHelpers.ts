import { PythonEnvironment } from '../types';

export function formatGraphOptionLabel(name: string, id: string): string {
  return `${name} (${id.slice(0, 8)})`;
}

export function getNextPythonEnvName(envs: PythonEnvironment[]): string {
  const existing = new Set(envs.map((env) => env.name));
  let index = 1;
  let candidate = `python_env_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `python_env_${index}`;
  }
  return candidate;
}
