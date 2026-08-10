import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const wranglerPackagePath = require.resolve("wrangler/package.json");
const wranglerPackage = JSON.parse(readFileSync(wranglerPackagePath, "utf8"));
const wranglerScript =
  process.env.WRANGLER_SCRIPT ||
  resolve(dirname(wranglerPackagePath), wranglerPackage.bin.wrangler);
const budgetBytes = Number.parseInt(
  process.env.WORKER_GZIP_BUDGET_BYTES || "",
  10,
);
const maxGzipBytes = Number.isFinite(budgetBytes)
  ? budgetBytes
  : 3 * 1024 * 1024;

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

function sizeToBytes(value, unit) {
  const multipliers = {
    B: 1,
    KIB: 1024,
    MIB: 1024 * 1024,
    GIB: 1024 * 1024 * 1024,
  };
  return Number.parseFloat(value.replaceAll(",", "")) * multipliers[unit];
}

function parseWranglerDryRunOutput(output) {
  const match = output.match(
    /Total Upload:\s*([\d,.]+)\s*(B|KiB|MiB|GiB)\s*\/\s*gzip:\s*([\d,.]+)\s*(B|KiB|MiB|GiB)/i,
  );
  if (!match) {
    throw new Error("Could not parse Wrangler dry-run output");
  }

  return {
    totalUploadBytes: sizeToBytes(match[1], match[2].toUpperCase()),
    gzipBytes: sizeToBytes(match[3], match[4].toUpperCase()),
  };
}

try {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [wranglerScript, "deploy", "--dry-run", "--config", "wrangler.jsonc"],
    {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const { gzipBytes } = parseWranglerDryRunOutput(`${stdout}\n${stderr}`);

  if (gzipBytes > maxGzipBytes) {
    console.error(
      `Wrangler gzip size ${formatBytes(
        gzipBytes,
      )} exceeds budget ${formatBytes(maxGzipBytes)}.`,
    );
    process.exit(1);
  }

  console.log(
    `Wrangler gzip size ${formatBytes(gzipBytes)} within budget ${formatBytes(
      maxGzipBytes,
    )}.`,
  );
} catch (error) {
  console.error(
    `Could not check Worker size. ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}
