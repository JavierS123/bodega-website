import "server-only";

import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

import { buildSystemPrompt } from "./prompt";
import { LlmOutput } from "./shared";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is missing or was rejected by Google");
  }
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

function isAuthRejection(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 401 || error.status === 403 || /API_KEY_INVALID|API key not valid/i.test(error.message);
}

/** Backoff before each retry of a transient error (keeps worst case well under a serverless timeout). */
const RETRY_DELAYS_MS = [700, 1_800];

function isTransient(error: unknown): boolean {
  return error instanceof ApiError && [429, 500, 502, 503, 504].includes(error.status);
}

export const GEMINI_MODEL =process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

/**
 * Extraction needs no reasoning, and less thinking = lower latency.
 * Gemini 2.5 models take a token budget (0 = off); Gemini 3.x use thinking levels.
 */
const thinkingConfig = GEMINI_MODEL.startsWith("gemini-2.")
  ? { thinkingBudget: 0 }
  : { thinkingLevel: ThinkingLevel.MINIMAL };

/** JSON Schema for Gemini's Structured Output, derived from the Zod schema (single source of truth). */
const responseJsonSchema = (() => {
  const schema = z.toJSONSchema(LlmOutput) as Record<string, unknown>;
  delete schema.$schema; // meta key not accepted by the Gemini schema subset
  return schema;
})();

/**
 * One stateless parse: catalog context in the system prompt, the user's text
 * as the only content. Output is schema-constrained by Gemini AND re-validated
 * with Zod here (throws on mismatch).
 */
export async function parseWithGemini(message: string, catalogText: string): Promise<LlmOutput> {
  const request = () =>
    getClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: message }] }],
      config: {
        systemInstruction: buildSystemPrompt(catalogText),
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0,
        thinkingConfig,
        maxOutputTokens: 1024,
        httpOptions: { timeout: 15_000 },
      },
    });

  let res: Awaited<ReturnType<typeof request>> | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await request();
      break;
    } catch (error) {
      // A rejected/missing key is a deployment misconfiguration, not a parsing failure.
      if (isAuthRejection(error)) throw new AiNotConfiguredError();
      // Google returns transient 429/500/503 ("high demand") under load — retry briefly.
      if (attempt >= RETRY_DELAYS_MS.length || !isTransient(error)) throw error;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  const text = res.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return LlmOutput.parse(JSON.parse(text));
}
