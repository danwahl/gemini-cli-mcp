import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiArgs,
  resolveModel,
  parseGeminiOutput,
  extractStructuredOutput,
  type GeminiOutput,
} from "./index.ts";

describe("resolveModel", () => {
  it("resolves 'auto' alias", () => {
    assert.equal(resolveModel("auto"), "gemini-2.5-pro");
  });

  it("resolves 'pro' alias", () => {
    assert.equal(resolveModel("pro"), "gemini-2.5-pro");
  });

  it("resolves 'flash' alias", () => {
    assert.equal(resolveModel("flash"), "gemini-2.0-flash");
  });

  it("resolves 'flash-lite' alias", () => {
    assert.equal(resolveModel("flash-lite"), "gemini-2.0-flash-lite");
  });

  it("passes through concrete model names unchanged", () => {
    assert.equal(resolveModel("gemini-2.5-pro"), "gemini-2.5-pro");
    assert.equal(resolveModel("gemini-1.5-pro-001"), "gemini-1.5-pro-001");
  });
});

describe("buildGeminiArgs", () => {
  it("builds args with default model", () => {
    const args = buildGeminiArgs("hello", "auto");
    assert.deepEqual(args, [
      "-p",
      "hello",
      "--model",
      "gemini-2.5-pro",
      "--output-format",
      "json",
      "--approval-mode",
      "yolo",
    ]);
  });

  it("builds args with flash model", () => {
    const args = buildGeminiArgs("hello", "flash");
    assert.equal(args[3], "gemini-2.0-flash");
  });

  it("builds args with explicit model name", () => {
    const args = buildGeminiArgs("test prompt", "gemini-1.5-flash");
    assert.equal(args[3], "gemini-1.5-flash");
  });

  it("includes --resume when sessionId provided", () => {
    const args = buildGeminiArgs("x", "auto", "my-session-id");
    const idx = args.indexOf("--resume");
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], "my-session-id");
  });

  it("omits --resume when sessionId not provided", () => {
    const args = buildGeminiArgs("x", "auto");
    assert.ok(!args.includes("--resume"));
  });

  it("includes --approval-mode yolo", () => {
    const args = buildGeminiArgs("x", "auto");
    const idx = args.indexOf("--approval-mode");
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], "yolo");
  });

  it("includes --output-format json", () => {
    const args = buildGeminiArgs("x", "auto");
    const idx = args.indexOf("--output-format");
    assert.ok(idx !== -1);
    assert.equal(args[idx + 1], "json");
  });
});

describe("parseGeminiOutput", () => {
  it("parses valid JSON response", () => {
    const result = parseGeminiOutput(JSON.stringify({ response: "Hello, world!" }));
    assert.equal(result.response, "Hello, world!");
    assert.equal(result.sessionId, null);
    assert.equal(result.stats, undefined);
  });

  it("extracts session_id", () => {
    const result = parseGeminiOutput(
      JSON.stringify({ session_id: "abc-123", response: "ok" })
    );
    assert.equal(result.sessionId, "abc-123");
  });

  it("extracts stats field", () => {
    const stats = { models: {}, tools: {} };
    const result = parseGeminiOutput(JSON.stringify({ response: "ok", stats }));
    assert.deepEqual(result.stats, stats);
  });

  it("handles missing stats gracefully", () => {
    const result = parseGeminiOutput(JSON.stringify({ response: "ok" }));
    assert.equal(result.stats, undefined);
  });

  it("returns raw stdout when JSON parsing fails", () => {
    const raw = "this is not json";
    const result = parseGeminiOutput(raw);
    assert.equal(result.response, raw);
    assert.equal(result.sessionId, null);
  });

  it("returns raw stdout for JSON without response field", () => {
    const raw = JSON.stringify({ message: "unexpected shape" });
    const result = parseGeminiOutput(raw);
    assert.equal(result.response, raw);
  });

  it("handles empty stdout", () => {
    const result = parseGeminiOutput("");
    assert.equal(result.response, "");
  });

  it("trims surrounding whitespace before parsing", () => {
    const result = parseGeminiOutput(
      "  " + JSON.stringify({ response: "trimmed" }) + "\n"
    );
    assert.equal(result.response, "trimmed");
  });
});

describe("extractStructuredOutput", () => {
  it("passes through sessionId and response", () => {
    const output: GeminiOutput = { sessionId: "abc", response: "hello" };
    const result = extractStructuredOutput(output);
    assert.equal(result.sessionId, "abc");
    assert.equal(result.response, "hello");
  });

  it("returns empty records when no stats", () => {
    const output: GeminiOutput = { sessionId: null, response: "hi" };
    const result = extractStructuredOutput(output);
    assert.deepEqual(result.models, {});
    assert.deepEqual(result.tools, {});
  });

  it("extracts model token totals", () => {
    const output: GeminiOutput = {
      sessionId: null,
      response: "hi",
      stats: {
        models: {
          "gemini-2.5-pro": { tokens: { total: 100 } },
          "gemini-2.0-flash": { tokens: { total: 50 } },
        },
      },
    };
    assert.deepEqual(extractStructuredOutput(output).models, {
      "gemini-2.5-pro": 100,
      "gemini-2.0-flash": 50,
    });
  });

  it("omits models with no token data", () => {
    const output: GeminiOutput = {
      sessionId: null,
      response: "hi",
      stats: { models: { "gemini-2.5-pro": {} } },
    };
    assert.deepEqual(extractStructuredOutput(output).models, {});
  });

  it("extracts tool call counts from byName", () => {
    const output: GeminiOutput = {
      sessionId: null,
      response: "hi",
      stats: {
        tools: {
          byName: {
            list_directory: { count: 2 },
            web_fetch: { count: 1 },
          },
        },
      },
    };
    assert.deepEqual(extractStructuredOutput(output).tools, {
      list_directory: 2,
      web_fetch: 1,
    });
  });

  it("returns empty tools when no tool calls", () => {
    const output: GeminiOutput = {
      sessionId: null,
      response: "hi",
      stats: { tools: { totalCalls: 0, byName: {} } },
    };
    assert.deepEqual(extractStructuredOutput(output).tools, {});
  });
});
