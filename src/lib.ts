import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export function buildGeminiArgs(
  prompt: string,
  model: string | undefined,
  sessionId?: string,
  outputFormat: string = "json"
): string[] {
  const args = ["-p", prompt, "--output-format", outputFormat, "--approval-mode", "yolo"];
  if (model) {
    args.push("--model", model);
  }
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  return args;
}

export interface GeminiOutput {
  sessionId: string | null;
  response: string;
  stats?: Record<string, unknown>;
}

export function parseGeminiOutput(stdout: string): GeminiOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { sessionId: null, response: "" };
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
        sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
        response: obj.response as string,
        stats: typeof obj.stats === "object" && obj.stats !== null
          ? (obj.stats as Record<string, unknown>)
          : undefined,
      };
    }
    return { sessionId: null, response: trimmed };
  } catch {
    return { sessionId: null, response: trimmed };
  }
}

export interface StructuredOutput {
  sessionId: string | null;
  response: string;
  models: Record<string, number>;  // model name → total tokens
  tools: Record<string, number>;   // tool name → call count
}

export function extractStructuredOutput(output: GeminiOutput): StructuredOutput {
  const models: Record<string, number> = {};
  const tools: Record<string, number> = {};

  const stats = output.stats;
  if (stats) {
    if (stats.models && typeof stats.models === "object") {
      for (const [name, modelStats] of Object.entries(stats.models as Record<string, unknown>)) {
        if (modelStats && typeof modelStats === "object") {
          const t = (modelStats as Record<string, unknown>).tokens;
          if (t && typeof t === "object" && typeof (t as Record<string, unknown>).total === "number") {
            models[name] = (t as Record<string, number>).total;
          }
        }
      }
    }

    if (stats.tools && typeof stats.tools === "object") {
      const byName = (stats.tools as Record<string, unknown>).byName;
      if (byName && typeof byName === "object") {
        for (const [name, toolStats] of Object.entries(byName as Record<string, unknown>)) {
          if (toolStats && typeof toolStats === "object") {
            const count = (toolStats as Record<string, unknown>).count;
            if (typeof count === "number") tools[name] = count;
          }
        }
      }
    }
  }

  return { sessionId: output.sessionId, response: output.response, models, tools };
}

export interface RunGeminiResult {
  output: GeminiOutput;
  isError: boolean;
  errorMessage?: string;
}

export function runGemini(
  prompt: string,
  cwd: string,
  model: string | undefined,
  timeoutMs: number,
  sessionId?: string
): Promise<RunGeminiResult> {
  if (!existsSync(cwd)) {
    return Promise.resolve({
      output: { sessionId: null, response: "" },
      isError: true,
      errorMessage: `Working directory does not exist: ${cwd}`,
    });
  }

  return new Promise((resolve) => {
    const args = buildGeminiArgs(prompt, model, sessionId);
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn("gemini", args, { cwd, env: process.env });
    } catch (err) {
      resolve({
        output: { sessionId: null, response: "" },
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
        output: { sessionId: null, response: "" },
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
          output: { sessionId: null, response: "" },
          isError: true,
          errorMessage: `gemini timed out after ${timeoutMs / 1000}s`,
        });
        return;
      }

      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        resolve({
          output: { sessionId: null, response: "" },
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