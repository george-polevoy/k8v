#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function parseArgs(argv) {
  const args = {
    json: false,
    failAbove: null,
    sessionsDir: join(homedir(), ".codex", "sessions"),
  };

  for (const arg of argv) {
    if (arg === "--json") {
      args.json = true;
      continue;
    }

    if (arg.startsWith("--fail-above=")) {
      const value = Number(arg.slice("--fail-above=".length));
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid --fail-above value: ${arg}`);
      }
      args.failAbove = value;
      continue;
    }

    if (arg.startsWith("--sessions-dir=")) {
      args.sessionsDir = arg.slice("--sessions-dir=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function walkJsonlFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function formatEpoch(epoch) {
  if (epoch == null) {
    return null;
  }

  const date = new Date(epoch * 1000);
  return {
    epoch,
    utc: date.toISOString().replace(".000Z", " UTC"),
    local: new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(date),
  };
}

function latestRateLimits(files) {
  const latest = new Map();
  const nowEpoch = Math.floor(Date.now() / 1000);

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const rateLimits = parsed?.payload?.rate_limits;
      if (!rateLimits) {
        continue;
      }

      const key = rateLimits.limit_id ?? rateLimits.limit_name ?? "default";
      latest.set(key, {
        timestamp: parsed.timestamp ?? null,
        file,
        limit_id: rateLimits.limit_id ?? null,
        limit_name: rateLimits.limit_name ?? null,
        plan_type: rateLimits.plan_type ?? null,
        active:
          (rateLimits.primary?.resets_at ?? 0) >= nowEpoch ||
          (rateLimits.secondary?.resets_at ?? 0) >= nowEpoch,
        primary: {
          used_percent: rateLimits.primary?.used_percent ?? null,
          window_minutes: rateLimits.primary?.window_minutes ?? null,
          resets_at: formatEpoch(rateLimits.primary?.resets_at ?? null),
        },
        secondary: {
          used_percent: rateLimits.secondary?.used_percent ?? null,
          window_minutes: rateLimits.secondary?.window_minutes ?? null,
          resets_at: formatEpoch(rateLimits.secondary?.resets_at ?? null),
        },
      });
    }
  }

  return Object.fromEntries(
    [...latest.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isOverBudget(snapshot, threshold) {
  if (threshold == null) {
    return false;
  }

  return [snapshot.primary.used_percent, snapshot.secondary.used_percent].some(
    (value) => typeof value === "number" && value >= threshold,
  );
}

function renderSnapshot(limitKey, snapshot) {
  const lines = [];
  lines.push(`${limitKey}${snapshot.limit_name ? ` (${snapshot.limit_name})` : ""}`);
  lines.push(`  timestamp: ${snapshot.timestamp ?? "unknown"}`);
  lines.push(`  plan_type: ${snapshot.plan_type ?? "unknown"}`);
  lines.push(`  active: ${snapshot.active ? "yes" : "no"}`);
  lines.push(
    `  primary: used_percent=${snapshot.primary.used_percent ?? "unknown"}, window_minutes=${snapshot.primary.window_minutes ?? "unknown"}, resets_at=${snapshot.primary.resets_at?.epoch ?? "unknown"}${snapshot.primary.resets_at ? ` (${snapshot.primary.resets_at.utc} | ${snapshot.primary.resets_at.local})` : ""}`,
  );
  lines.push(
    `  secondary: used_percent=${snapshot.secondary.used_percent ?? "unknown"}, window_minutes=${snapshot.secondary.window_minutes ?? "unknown"}, resets_at=${snapshot.secondary.resets_at?.epoch ?? "unknown"}${snapshot.secondary.resets_at ? ` (${snapshot.secondary.resets_at.utc} | ${snapshot.secondary.resets_at.local})` : ""}`,
  );
  lines.push(`  source_file: ${snapshot.file}`);
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionsStats = statSync(args.sessionsDir, { throwIfNoEntry: false });
  if (!sessionsStats?.isDirectory()) {
    throw new Error(`Sessions directory not found: ${args.sessionsDir}`);
  }

  const snapshots = latestRateLimits(walkJsonlFiles(args.sessionsDir));
  const limitKeys = Object.keys(snapshots).filter((key) => snapshots[key].active);
  if (limitKeys.length === 0) {
    throw new Error(`No non-null rate_limits snapshots found under ${args.sessionsDir}`);
  }

  const overBudget = limitKeys.filter((key) => isOverBudget(snapshots[key], args.failAbove));

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          threshold: args.failAbove,
          ok: overBudget.length === 0,
          over_budget: overBudget,
          snapshots,
        },
        null,
        2,
      ),
    );
  } else {
    if (args.failAbove != null) {
      console.log(`threshold: fail when used_percent >= ${args.failAbove}`);
      console.log(`status: ${overBudget.length === 0 ? "ok" : "over_budget"}`);
      if (overBudget.length > 0) {
        console.log(`over_budget_limits: ${overBudget.join(", ")}`);
      }
      console.log("");
    }

    for (const limitKey of limitKeys) {
      console.log(renderSnapshot(limitKey, snapshots[limitKey]));
      console.log("");
    }
  }

  if (overBudget.length > 0) {
    process.exitCode = 2;
  }
}

main();
