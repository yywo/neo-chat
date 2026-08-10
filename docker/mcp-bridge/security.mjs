import { timingSafeEqual } from "node:crypto";

const MAX_LOG_SOURCE_CHARS = 8 * 1024;
const SECRET_NAME =
  "authorization|proxy-authorization|aws_secret_access_key|secretaccesskey|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|token";
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `(^|[\\s,{;])(["']?(?:${SECRET_NAME})["']?)\\s*[:=]\\s*(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\r\\n,;}]+)`,
  "gim",
);
const SECRET_QUERY_PATTERN = new RegExp(
  `([?&](?:${SECRET_NAME})=)[^&#\\s]*`,
  "gi",
);

export function validateBridgeToken(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 4096) {
    throw new Error("MCP_BRIDGE_TOKEN must contain 32 to 4096 characters");
  }
  if (/\s/.test(token)) {
    throw new Error("MCP_BRIDGE_TOKEN must not contain whitespace");
  }
  return token;
}

export function isAuthorizedBearer(header, expectedToken) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }

  const supplied = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

export function redactLogMessage(value) {
  return String(value)
    .slice(0, MAX_LOG_SOURCE_CHARS)
    .replace(/\b(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(SECRET_QUERY_PATTERN, "$1[redacted]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1$2=[redacted]")
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/-]+={0,2}/gi, "$1 [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 2048);
}

export function assertBoundedResult(value, maxOutputBytes) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > maxOutputBytes) {
    throw new Error(`MCP result exceeded the ${maxOutputBytes} byte limit`);
  }
  return value;
}
