import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";

const MODEL_ALIASES: Record<string, string> = {
  auto: "gemini-2.5-pro",
  pro: "gemini-2.5-pro",
  flash: "gemini-2.0-flash",
  "flash-lite": "gemini-2.0-flash-lite",
};

export function resolveModel(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

export function buildGeminiArgs(
  prompt: string,
  model: string,
  outputFormat: string = "json"
): string[] {
  return [
    "-p",
    prompt,
    "--model",
    resolveModel(model),
    "--output-format",
    outputFormat,
    "--approval-mode",
    "yolo",
  ];
}

export interface GeminiStats {
  models?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  files?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GeminiOutput {
  response: string;
  stats?: GeminiStats;
}

export function parseGeminiOutput(stdout: string): GeminiOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { response: "" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "response" in parsed &&
      typeof (parsed as Record<string, unknown>).response === "string"
    ) {
      const obj = parsed as Record<string, unknown>;
      return {
        response: obj.response as string,
        stats:
          obj.stats !== undefined ? (obj.stats as GeminiStats) : undefined,
      };
    }
    // JSON but unexpected shape — return raw
    return { response: trimmed };
  } catch {
    // Not JSON — return raw stdout
    return { response: trimmed };
  }
}

export interface StructuredOutput {
  response: string;
  models: string[];
  totalTokens: number | null;
}

export function extractStructuredOutput(output: GeminiOutput): StructuredOutput {
  const models: string[] = [];
  let totalTokens: number | null = null;

  if (output.stats?.models && typeof output.stats.models === "object") {
    const rawModels = output.stats.models as Record<string, unknown>;
    models.push(...Object.keys(rawModels));
    for (const modelStats of Object.values(rawModels)) {
      if (modelStats && typeof modelStats === "object") {
        const ms = modelStats as Record<string, unknown>;
        if (typeof ms.totalTokenCount === "number") {
          totalTokens = (totalTokens ?? 0) + ms.totalTokenCount;
        }
      }
    }
  }

  return { response: output.response, models, totalTokens };
}

export interface RunGeminiResult {
  output: GeminiOutput;
  isError: boolean;
  errorMessage?: string;
}

export function runGemini(
  prompt: string,
  cwd: string,
  model: string,
  timeoutMs: number
): Promise<RunGeminiResult> {
  if (!existsSync(cwd)) {
    return Promise.resolve({
      output: { response: "" },
      isError: true,
      errorMessage: `Working directory does not exist: ${cwd}`,
    });
  }

  return new Promise((resolve) => {
    const args = buildGeminiArgs(prompt, model);
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn("gemini", args, { cwd, env: process.env });
    } catch (err) {
      resolve({
        output: { response: "" },
        isError: true,
        errorMessage: `Failed to spawn gemini: ${String(err)}. Is gemini-cli installed? Try: npm install -g @google/gemini-cli`,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 5000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const isNotFound =
        (err as NodeJS.ErrnoException).code === "ENOENT" ||
        err.message.includes("ENOENT");
      resolve({
        output: { response: "" },
        isError: true,
        errorMessage: isNotFound
          ? `gemini binary not found. Install with: npm install -g @google/gemini-cli`
          : `Failed to spawn gemini: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          output: { response: "" },
          isError: true,
          errorMessage: `gemini timed out after ${timeoutMs / 1000}s`,
        });
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        resolve({
          output: { response: "" },
          isError: true,
          errorMessage: `gemini exited with code ${code}: ${detail}`,
        });
        return;
      }

      resolve({
        output: parseGeminiOutput(stdout),
        isError: false,
      });
    });
  });
}

const server = new McpServer({
  name: "gemini-cli-mcp",
  version: "0.1.0",
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
        .default("auto")
        .describe(
          'Model to use. Aliases: "auto" (default, smart routing), "pro" (gemini-2.5-pro), ' +
            '"flash" (gemini-2.0-flash), "flash-lite" (gemini-2.0-flash-lite). ' +
            "Or pass a concrete model name like \"gemini-2.5-pro\"."
        ),
    },
    outputSchema: {
      response: z.string().describe("Gemini's text response"),
      models: z.array(z.string()).describe("Model(s) used during the task"),
      totalTokens: z
        .number()
        .nullable()
        .describe("Total token count across all models, if reported"),
    },
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
    },
  },
  async ({ prompt, cwd, model }) => {
    const timeoutMs = 120_000;
    const result = await runGemini(prompt, cwd, model ?? "auto", timeoutMs);

    if (result.isError) {
      return {
        isError: true,
        content: [{ type: "text", text: result.errorMessage ?? "Unknown error" }],
      };
    }

    const structured = extractStructuredOutput(result.output);
    return {
      content: [{ type: "text", text: structured.response }],
      structuredContent: structured as unknown as Record<string, unknown>,
    };
  }
);

// Only connect when run directly (not imported by tests)
const isMain =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith("cli.js") ||
    process.argv[1].endsWith("dist/index.js"));

if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
