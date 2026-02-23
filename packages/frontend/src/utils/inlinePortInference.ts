const PORT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const INPUT_HELPER_METHODS = new Set([
  'get',
  'items',
  'keys',
  'values',
  'pop',
  'setdefault',
  'update',
  'copy',
  'clear',
  'fromkeys',
]);

interface PortMatch {
  name: string;
  index: number;
}

function collectMatches(code: string, pattern: RegExp): PortMatch[] {
  const matches: PortMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const candidate = match[1];
    if (!candidate || !PORT_NAME_PATTERN.test(candidate)) {
      continue;
    }

    matches.push({
      name: candidate,
      index: match.index,
    });
  }

  return matches;
}

function uniqueByFirstAppearance(matches: PortMatch[]): string[] {
  const ordered = [...matches].sort((left, right) => left.index - right.index);
  const seen = new Set<string>();
  const names: string[] = [];

  for (const entry of ordered) {
    if (seen.has(entry.name)) {
      continue;
    }
    seen.add(entry.name);
    names.push(entry.name);
  }

  return names;
}

export function inferInlineInputPortNames(code: string): string[] {
  if (!code.trim()) {
    return [];
  }

  const dotMatches = collectMatches(code, /\binputs\.([A-Za-z_][A-Za-z0-9_]*)\b/g)
    .filter((entry) => !INPUT_HELPER_METHODS.has(entry.name));
  const bracketMatches = collectMatches(
    code,
    /\binputs\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g
  );
  const getMatches = collectMatches(
    code,
    /\binputs\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*(?:,|\))/g
  );

  return uniqueByFirstAppearance([...dotMatches, ...bracketMatches, ...getMatches]);
}

export function inferInlineOutputPortNames(code: string): string[] {
  if (!code.trim()) {
    return [];
  }

  const dotMatches = collectMatches(code, /\boutputs\.([A-Za-z_][A-Za-z0-9_]*)\b/g)
    .filter((entry) => !INPUT_HELPER_METHODS.has(entry.name));
  const bracketMatches = collectMatches(
    code,
    /\boutputs\s*\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g
  );

  return uniqueByFirstAppearance([...dotMatches, ...bracketMatches]);
}
