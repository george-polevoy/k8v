const FALLBACK_DIAGNOSTICS_MESSAGE = 'The backend request failed. Please try again.';

function firstNonEmptyLine(value: string): string {
  const lines = value.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return value.trim();
}

export function toHumanReadableDiagnosticsMessage(rawError: string | null): string | null {
  if (!rawError) {
    return null;
  }

  const firstLine = firstNonEmptyLine(rawError);
  const normalized = firstLine.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const lower = normalized.toLowerCase();

  if (
    lower.includes('payloadtoolarge') ||
    lower.includes('request entity too large') ||
    lower.includes('status code 413')
  ) {
    return 'The request is too large for the backend. Reduce the graph payload and try again.';
  }

  if (
    lower.includes('network error') ||
    lower.includes('failed to fetch') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout')
  ) {
    return 'Cannot reach the backend right now. Check the backend service and try again.';
  }

  if (lower.includes('graph not found')) {
    return 'The selected graph no longer exists. Reload the graph list and try again.';
  }

  if (lower.includes('validation failed')) {
    return 'The backend rejected the request because some graph data is invalid.';
  }

  if (/request failed with status code 5\d\d/i.test(normalized)) {
    return 'The backend failed while processing the request. Please try again.';
  }

  if (/request failed with status code 4\d\d/i.test(normalized)) {
    return 'The backend rejected the request. Review the change and try again.';
  }

  if (/^[A-Za-z0-9 ,.'"-]+$/.test(normalized) && !/\bError:/.test(normalized)) {
    return normalized;
  }

  return FALLBACK_DIAGNOSTICS_MESSAGE;
}

