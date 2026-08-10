import { BROWSER_SANDBOX_LIMITS } from "@/config/limits";
import { runInSandbox } from "@/utils/sandbox";

import type { BuiltinToolBinding } from "./types";

function errorResult(code: string, message: string) {
  return {
    error: {
      code,
      message,
      recoverable: true,
    },
  };
}

function boundOutput(output: string): string {
  if (output.length <= BROWSER_SANDBOX_LIMITS.maxOutputChars) return output;
  const notice = "\n[Output truncated to the browser sandbox limit.]";
  return (
    output.slice(
      0,
      Math.max(0, BROWSER_SANDBOX_LIMITS.maxOutputChars - notice.length),
    ) + notice
  );
}

export function createJavaScriptBinding(): BuiltinToolBinding {
  return {
    definition: {
      type: "function",
      function: {
        name: "run_javascript",
        description:
          "Run bounded synchronous JavaScript for calculations in an isolated browser sandbox. The sandbox has no network, DOM, storage, imports, or external libraries.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: {
              type: "string",
              minLength: 1,
              maxLength: BROWSER_SANDBOX_LIMITS.maxCodeChars,
              description:
                "Synchronous JavaScript. Use console.log or a return value for output.",
            },
          },
          required: ["code"],
        },
      },
    },
    risk: "read",
    displayKey: "javascript",
    agentOnly: true,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      const input =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!code) {
        return errorResult(
          "JAVASCRIPT_INVALID_CODE",
          "run_javascript requires non-empty JavaScript code.",
        );
      }
      if (code.length > BROWSER_SANDBOX_LIMITS.maxCodeChars) {
        return errorResult(
          "JAVASCRIPT_CODE_TOO_LARGE",
          "JavaScript code exceeds the browser sandbox limit.",
        );
      }

      try {
        const output = boundOutput(await runInSandbox(code, context.signal));
        context.signal?.throwIfAborted();
        if (/(^|\n)Error:/.test(output)) {
          return errorResult("JAVASCRIPT_EXECUTION_FAILED", output);
        }
        return { output };
      } catch (error) {
        if (
          context.signal?.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw error;
        }
        return errorResult(
          "JAVASCRIPT_EXECUTION_FAILED",
          error instanceof Error
            ? error.message
            : "JavaScript execution failed.",
        );
      }
    },
  };
}
