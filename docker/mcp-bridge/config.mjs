import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { DEFAULT_INHERITED_ENV_VARS } from "@modelcontextprotocol/sdk/client/stdio.js";

const MAX_CONFIG_BYTES = 256 * 1024;
const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function assertString(value, label, maxLength = 4096) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function boundedInteger(value, fallback, min, max, label) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return resolved;
}

function normalizeServer(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`servers[${index}] must be an object`);
  }

  const id = assertString(raw.id, `servers[${index}].id`, 64);
  if (!SERVER_ID_PATTERN.test(id)) {
    throw new Error(`servers[${index}].id contains unsupported characters`);
  }

  const command = assertString(raw.command, `servers[${index}].command`, 1024);
  const label = assertString(raw.label ?? id, `servers[${index}].label`, 128);
  const args = raw.args ?? [];
  if (!Array.isArray(args) || args.length > 64) {
    throw new Error(`servers[${index}].args must contain at most 64 entries`);
  }
  const normalizedArgs = args.map((arg, argIndex) =>
    assertString(arg, `servers[${index}].args[${argIndex}]`),
  );

  const envAllowlist = raw.envAllowlist ?? [];
  if (!Array.isArray(envAllowlist) || envAllowlist.length > 64) {
    throw new Error(
      `servers[${index}].envAllowlist must contain at most 64 entries`,
    );
  }
  const normalizedEnvAllowlist = envAllowlist.map((name, envIndex) => {
    const normalized = assertString(
      name,
      `servers[${index}].envAllowlist[${envIndex}]`,
      128,
    );
    if (!ENV_NAME_PATTERN.test(normalized)) {
      throw new Error(
        `servers[${index}].envAllowlist[${envIndex}] is not an environment variable name`,
      );
    }
    return normalized;
  });

  let cwd;
  if (raw.cwd !== undefined) {
    cwd = assertString(raw.cwd, `servers[${index}].cwd`, 1024);
    if (!isAbsolute(cwd)) {
      throw new Error(`servers[${index}].cwd must be an absolute path`);
    }
  }

  return Object.freeze({
    id,
    label,
    command,
    args: Object.freeze(normalizedArgs),
    envAllowlist: Object.freeze([...new Set(normalizedEnvAllowlist)]),
    ...(cwd ? { cwd } : {}),
    timeoutMs: boundedInteger(
      raw.timeoutMs,
      30_000,
      1_000,
      300_000,
      `servers[${index}].timeoutMs`,
    ),
    maxOutputBytes: boundedInteger(
      raw.maxOutputBytes,
      1024 * 1024,
      1024,
      10 * 1024 * 1024,
      `servers[${index}].maxOutputBytes`,
    ),
    maxSessions: boundedInteger(
      raw.maxSessions,
      16,
      1,
      128,
      `servers[${index}].maxSessions`,
    ),
  });
}

export function parseBridgeConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Bridge config must be an object");
  }
  if (raw.version !== 1) {
    throw new Error("Bridge config version must be 1");
  }
  if (
    !Array.isArray(raw.servers) ||
    raw.servers.length === 0 ||
    raw.servers.length > 32
  ) {
    throw new Error("Bridge config must define 1 to 32 servers");
  }

  const servers = raw.servers.map(normalizeServer);
  const ids = new Set();
  for (const server of servers) {
    if (ids.has(server.id))
      throw new Error(`Duplicate server id: ${server.id}`);
    ids.add(server.id);
  }

  return Object.freeze({ version: 1, servers: Object.freeze(servers) });
}

export function loadBridgeConfig(configPath) {
  const size = statSync(configPath).size;
  if (size > MAX_CONFIG_BYTES) {
    throw new Error(`Bridge config exceeds ${MAX_CONFIG_BYTES} bytes`);
  }

  return parseBridgeConfig(JSON.parse(readFileSync(configPath, "utf8")));
}

export function buildChildEnvironment(config, source = process.env) {
  // The SDK always merges a small platform-default environment into this
  // object. Explicit empty values neutralize defaults that the deployer did
  // not allowlist, while PATH remains available so fixed commands can run.
  const environment = Object.fromEntries(
    DEFAULT_INHERITED_ENV_VARS.map((name) => [name, ""]),
  );
  environment.PATH = source.PATH || "/usr/local/bin:/usr/bin:/bin";

  for (const name of config.envAllowlist) {
    const value = source[name];
    if (typeof value === "string") environment[name] = value;
  }

  return environment;
}
