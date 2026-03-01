import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGeminiArgs,
  resolveModel,
  parseGeminiOutput,
  formatStatsLine,
  type GeminiStats,
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
    const result = parseGeminiOutput(
      JSON.stringify({ response: "Hello, world!" })
    );
    assert.equal(result.response, "Hello, world!");
    assert.equal(result.stats, undefined);
  });

  it("extracts response and stats fields", () => {
    const stats = { models: { "gemini-2.5-pro": { totalTokenCount: 42 } } };
    const result = parseGeminiOutput(
      JSON.stringify({ response: "Answer", stats })
    );
    assert.equal(result.response, "Answer");
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
    assert.equal(result.stats, undefined);
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

describe("formatStatsLine", () => {
  it("returns empty string for undefined stats", () => {
    assert.equal(formatStatsLine(undefined), "");
  });

  it("returns empty string for empty stats object", () => {
    assert.equal(formatStatsLine({} as GeminiStats), "");
  });

  it("includes model name when present", () => {
    const stats: GeminiStats = {
      models: { "gemini-2.5-pro": {} },
    };
    const line = formatStatsLine(stats);
    assert.ok(line.includes("gemini-2.5-pro"), `expected model in: ${line}`);
  });

  it("includes token count when present", () => {
    const stats: GeminiStats = {
      models: { "gemini-2.5-pro": { totalTokenCount: 123 } },
    };
    const line = formatStatsLine(stats);
    assert.ok(line.includes("123"), `expected token count in: ${line}`);
  });

  it("wraps output in brackets", () => {
    const stats: GeminiStats = {
      models: { "gemini-2.5-pro": { totalTokenCount: 1 } },
    };
    const line = formatStatsLine(stats);
    assert.ok(line.startsWith("[") && line.endsWith("]"));
  });
});
