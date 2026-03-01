import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { z } from "zod";
import { runGemini, extractStructuredOutput } from "./lib.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({
  name: "gemini-cli-mcp",
  version,
});

server.registerTool(
  "cli",
  {
    description:
      "Send a task or question to Gemini CLI and return the response. " +
      "Gemini runs headlessly with full tool access (file read/write, web search, shell commands). " +
      "Use this to delegate tasks that benefit from Gemini's capabilities or to get a second opinion.",
    inputSchema: {
      prompt: z
        .string()
        .describe("The task or question to send to Gemini CLI"),
      cwd: z
        .string()
        .describe(
          "Absolute path to the working directory for Gemini to operate in"
        ),
      model: z
        .string()
        .optional()
        .describe(
          "Model to use. Omit to use Gemini CLI's default (auto). " +
          "Official aliases: \"auto\" (default routing), \"pro\" (complex reasoning), " +
          "\"flash\" (fast, balanced), \"flash-lite\" (fastest). " +
          "Or pass a concrete model name like \"gemini-2.5-pro\"."
        ),
      sessionId: z
        .string()
        .optional()
        .describe(
          "Resume a previous Gemini session by ID. The session ID is returned in the structured output of each call."
        ),
    },
    outputSchema: {
      sessionId: z.string().nullable().describe("Gemini CLI session ID"),
      response: z.string().describe("Gemini's text response"),
      models: z.record(z.string(), z.number()).describe("Model name → total tokens used"),
      tools: z.record(z.string(), z.number()).describe("Tool name → call count"),
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
    },
  },
  async ({ prompt, cwd, model, sessionId }) => {
    const timeoutMs = 120_000;
    const result = await runGemini(prompt, cwd, model, timeoutMs, sessionId);

    if (result.isError) {
      return {
        isError: true,
        content: [{ type: "text", text: result.errorMessage ?? "Unknown error" }],
        structuredContent: { sessionId: null, response: "", models: {}, tools: {} } as unknown as Record<string, unknown>,
      };
    }

    const structured = extractStructuredOutput(result.output);
    return {
      content: [{ type: "text", text: structured.response }],
      structuredContent: structured as unknown as Record<string, unknown>,
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);