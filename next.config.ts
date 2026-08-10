import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { networkInterfaces } from "node:os";
import { getSecurityHeaders } from "./src/lib/security/headers";
import {
  normalizeDeploymentId,
  resolveDeploymentId,
} from "./src/lib/pwa/deploymentId";

initOpenNextCloudflareForDev();

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const allowedDevOrigins = new Set(["127.0.0.1", "localhost"]);
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === "IPv4" && !address.internal) {
      allowedDevOrigins.add(address.address);
    }
  }
}

function readBuiltDeploymentId(): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(
        resolve(process.cwd(), ".next/required-server-files.json"),
        "utf8",
      ),
    ) as { config?: { deploymentId?: unknown } };
    return typeof manifest.config?.deploymentId === "string"
      ? normalizeDeploymentId(manifest.config.deploymentId)
      : null;
  } catch {
    return null;
  }
}

function getDeploymentId(phase: string): string {
  if (phase === PHASE_DEVELOPMENT_SERVER) return "development";

  if (phase === PHASE_PRODUCTION_SERVER) {
    const builtDeploymentId = readBuiltDeploymentId();
    if (builtDeploymentId) return builtDeploymentId;
  }

  const fallbackDeploymentId = `build-${Date.now().toString(36)}-${randomUUID()
    .slice(0, 8)
    .toLowerCase()}`;
  return resolveDeploymentId(process.env, fallbackDeploymentId);
}

function createNextConfig(phase: string): NextConfig {
  const deploymentId = getDeploymentId(phase);

  return {
    /* config options here */
    output: "standalone",
    deploymentId,
    env: {
      NEXT_PUBLIC_DEPLOYMENT_ID: deploymentId,
    },
    reactCompiler: true,
    allowedDevOrigins: [...allowedDevOrigins],
    experimental: {
      optimizePackageImports: ["lucide-react"],
    },
    async headers() {
      return [
        {
          source: "/sw.js",
          headers: [
            {
              key: "Cache-Control",
              value: "no-cache, no-store, must-revalidate",
            },
            { key: "Service-Worker-Allowed", value: "/" },
          ],
        },
        {
          source: "/sw-runtime.js",
          headers: [
            {
              key: "Cache-Control",
              value: "no-cache, no-store, must-revalidate",
            },
          ],
        },
        {
          source: "/:path*",
          headers: getSecurityHeaders(),
        },
      ];
    },
  };
}

export default function config(phase: string) {
  return withNextIntl(createNextConfig(phase));
}
