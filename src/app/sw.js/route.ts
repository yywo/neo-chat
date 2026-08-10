import { normalizeDeploymentId } from "@/lib/pwa/deploymentId";
import { createServiceWorkerBootstrap } from "@/lib/pwa/serviceWorkerBootstrap";

export const dynamic = "force-dynamic";

export function GET() {
  const deploymentId =
    normalizeDeploymentId(process.env.NEXT_PUBLIC_DEPLOYMENT_ID ?? "") ??
    "unknown";

  return new Response(createServiceWorkerBootstrap(deploymentId), {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
    },
  });
}
