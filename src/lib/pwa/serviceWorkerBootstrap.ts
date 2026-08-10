import { PWA_RUNTIME_SCRIPT_URL } from "./policy";

export function createServiceWorkerBootstrap(deploymentId: string): string {
  const runtimeUrl = `${PWA_RUNTIME_SCRIPT_URL}?dpl=${encodeURIComponent(
    deploymentId,
  )}`;

  return [
    `self.__NEO_CHAT_DEPLOYMENT_ID__ = ${JSON.stringify(deploymentId)};`,
    `importScripts(${JSON.stringify(runtimeUrl)});`,
    "",
  ].join("\n");
}
