const DEPLOYMENT_ID_ENV_KEYS = [
  "NEXT_DEPLOYMENT_ID",
  "DEPLOYMENT_VERSION",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
] as const;

const MAX_DEPLOYMENT_ID_LENGTH = 128;

export function normalizeDeploymentId(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_DEPLOYMENT_ID_LENGTH);

  return normalized || null;
}

export function resolveDeploymentId(
  env: Readonly<Record<string, string | undefined>>,
  fallback: string,
): string {
  for (const key of DEPLOYMENT_ID_ENV_KEYS) {
    const deploymentId = normalizeDeploymentId(env[key] ?? "");
    if (deploymentId) return deploymentId;
  }

  return normalizeDeploymentId(fallback) ?? "build";
}
