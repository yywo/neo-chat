import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { assertBoundedResult } from "./security.mjs";

function requestOptions(config, signal) {
  return {
    signal,
    timeout: config.timeoutMs,
    maxTotalTimeout: config.timeoutMs,
  };
}

function bound(config, value) {
  return assertBoundedResult(value, config.maxOutputBytes);
}

async function forward(runtime, config, signal, operation) {
  return bound(
    config,
    await runtime.execute(operation, {
      signal,
    }),
  );
}

function forwardedCapabilities(upstream) {
  return {
    ...(upstream?.tools ? { tools: { listChanged: false } } : {}),
    ...(upstream?.resources
      ? {
          resources: {
            subscribe: false,
            listChanged: false,
          },
        }
      : {}),
    ...(upstream?.prompts ? { prompts: { listChanged: false } } : {}),
    ...(upstream?.completions ? { completions: {} } : {}),
  };
}

export async function createProxyServer(runtime, config) {
  const initialClient = await runtime.getClient();
  const capabilities = forwardedCapabilities(
    initialClient.getServerCapabilities(),
  );
  const upstreamVersion = initialClient.getServerVersion();
  const server = new Server(
    {
      name: `neo-chat-bridge:${config.id}`,
      version: upstreamVersion?.version || "2.4.0",
    },
    { capabilities },
  );

  if (capabilities.tools) {
    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      return forward(runtime, config, extra.signal, (client) =>
        client.listTools(request.params, requestOptions(config, extra.signal)),
      );
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      return forward(runtime, config, extra.signal, (client) =>
        client.callTool(
          request.params,
          undefined,
          requestOptions(config, extra.signal),
        ),
      );
    });
  }

  if (capabilities.resources) {
    server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request, extra) =>
        forward(runtime, config, extra.signal, (client) =>
          client.listResources(
            request.params,
            requestOptions(config, extra.signal),
          ),
        ),
    );
    server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      async (request, extra) =>
        forward(runtime, config, extra.signal, (client) =>
          client.listResourceTemplates(
            request.params,
            requestOptions(config, extra.signal),
          ),
        ),
    );
    server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request, extra) =>
        forward(runtime, config, extra.signal, (client) =>
          client.readResource(
            request.params,
            requestOptions(config, extra.signal),
          ),
        ),
    );
  }

  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async (request, extra) =>
      forward(runtime, config, extra.signal, (client) =>
        client.listPrompts(
          request.params,
          requestOptions(config, extra.signal),
        ),
      ),
    );
    server.setRequestHandler(GetPromptRequestSchema, async (request, extra) => {
      return forward(runtime, config, extra.signal, (client) =>
        client.getPrompt(request.params, requestOptions(config, extra.signal)),
      );
    });
  }

  if (capabilities.completions) {
    server.setRequestHandler(CompleteRequestSchema, async (request, extra) => {
      return forward(runtime, config, extra.signal, (client) =>
        client.complete(request.params, requestOptions(config, extra.signal)),
      );
    });
  }

  return server;
}
