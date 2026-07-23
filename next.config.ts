import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { networkInterfaces } from "node:os";
import { getSecurityHeaders } from "./src/lib/security/headers";

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

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  reactCompiler: true,
  allowedDevOrigins: [...allowedDevOrigins],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
