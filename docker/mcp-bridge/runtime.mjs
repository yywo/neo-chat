import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";

import { buildChildEnvironment } from "./config.mjs";

const MAX_STDERR_LOG_BYTES = 8 * 1024;
const MAX_JSON_RPC_ENVELOPE_BYTES = 64 * 1024;

// The SDK is pinned because its stdio buffer is private at the type level.
// The fixture test for an unterminated frame is the upgrade gate for this hook.
class BoundedStdioClientTransport extends StdioClientTransport {
  constructor(server, maxResultBytes) {
    super(server);
    this.maxFrameBytes = maxResultBytes + MAX_JSON_RPC_ENVELOPE_BYTES;
    this.frameLimitExceeded = false;
  }

  processReadBuffer() {
    if (this.frameLimitExceeded) {
      this._readBuffer.clear();
      return;
    }

    while (true) {
      const buffer = this._readBuffer._buffer;
      if (buffer) {
        const newlineIndex = buffer.indexOf("\n");
        const frameBytes =
          newlineIndex === -1 ? buffer.byteLength : newlineIndex;
        if (frameBytes > this.maxFrameBytes) {
          this.frameLimitExceeded = true;
          this._readBuffer.clear();
          this.onerror?.(
            new Error(`MCP stdio frame exceeded ${this.maxFrameBytes} bytes`),
          );
          return;
        }
      }

      try {
        const message = this._readBuffer.readMessage();
        if (message === null) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class StdioRuntime {
  constructor(config, logger = console) {
    this.config = config;
    this.logger = logger;
    this.client = null;
    this.transport = null;
    this.starting = null;
    this.retiring = null;
    this.closed = false;
    this.restartAttempt = 0;
    this.nextStartAt = 0;
  }

  async getClient() {
    if (this.closed) throw new Error("MCP bridge is shutting down");
    if (this.retiring) await this.retiring;
    if (this.closed) throw new Error("MCP bridge is shutting down");
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = this.#start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  #scheduleRestart(reason) {
    this.restartAttempt += 1;
    const backoff = Math.min(30_000, 500 * 2 ** (this.restartAttempt - 1));
    this.nextStartAt = Date.now() + backoff;
    if (!this.closed) {
      this.logger.warn(
        `[${this.config.id}] stdio runtime unhealthy (${reason}); restart delayed ${backoff}ms`,
      );
    }
    return backoff;
  }

  async markUnhealthy(client, reason) {
    if (this.client !== client) {
      if (this.retiring) await this.retiring;
      return;
    }
    this.client = null;
    this.transport = null;
    const backoff = this.#scheduleRestart(reason);
    const retirement = client.close().catch(() => {});
    this.retiring = retirement;
    await retirement;
    if (this.retiring === retirement) {
      this.retiring = null;
      this.nextStartAt = Math.max(this.nextStartAt, Date.now() + backoff);
    }
  }

  async execute(operation, { signal } = {}) {
    const client = await this.getClient();
    try {
      return await operation(client);
    } catch (error) {
      if (signal?.aborted || error?.code === ErrorCode.RequestTimeout) {
        await this.markUnhealthy(
          client,
          signal?.aborted ? "request-aborted" : "request-timeout",
        );
      }
      throw error;
    }
  }

  async #start() {
    const backoffMs = Math.max(0, this.nextStartAt - Date.now());
    if (backoffMs > 0) await delay(backoffMs);
    if (this.closed) throw new Error("MCP bridge is shutting down");

    const transport = new BoundedStdioClientTransport(
      {
        command: this.config.command,
        args: [...this.config.args],
        env: buildChildEnvironment(this.config),
        ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
        stderr: "pipe",
      },
      this.config.maxOutputBytes,
    );
    const client = new Client(
      { name: "neo-chat-mcp-bridge", version: "2.4.0" },
      { capabilities: {} },
    );

    let stderrBytes = 0;
    let stderrObserved = false;
    let stderrTruncated = false;
    transport.stderr?.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (!stderrObserved) {
        stderrObserved = true;
        this.logger.warn(`[${this.config.id}] child stderr content suppressed`);
      }
      if (stderrBytes > MAX_STDERR_LOG_BYTES && !stderrTruncated) {
        stderrTruncated = true;
        this.logger.warn(`[${this.config.id}] child stderr limit reached`);
      }
    });

    const markClosed = () => {
      if (this.client !== client) return;
      this.client = null;
      this.transport = null;
      this.#scheduleRestart("process-stopped");
    };
    client.onclose = markClosed;
    client.onerror = () => {
      this.logger.error(`[${this.config.id}] MCP transport error`);
      if (this.client === client) {
        void this.markUnhealthy(client, "transport-error");
      } else {
        void transport.close().catch(() => {});
      }
    };

    try {
      await client.connect(transport, { timeout: this.config.timeoutMs });
      this.client = client;
      this.transport = transport;
      this.restartAttempt = 0;
      this.nextStartAt = 0;
      this.logger.info(`[${this.config.id}] stdio process ready`);
      return client;
    } catch (error) {
      await transport.close().catch(() => {});
      this.#scheduleRestart("start-failed");
      throw error;
    }
  }

  async close() {
    this.closed = true;
    const client = this.client;
    const retirement = this.retiring;
    this.client = null;
    this.transport = null;
    await Promise.all([
      retirement,
      client ? client.close().catch(() => {}) : undefined,
    ]);
  }
}

export class RuntimeManager {
  constructor(configs, logger = console) {
    this.runtimes = new Map(
      configs.map((config) => [config.id, new StdioRuntime(config, logger)]),
    );
  }

  get(id) {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error("Unknown MCP server");
    return runtime;
  }

  async close() {
    await Promise.all(
      [...this.runtimes.values()].map((runtime) => runtime.close()),
    );
  }
}
