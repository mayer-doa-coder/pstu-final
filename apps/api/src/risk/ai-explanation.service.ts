import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_EXPLANATION_LENGTH = 500;

const SYSTEM_PROMPT =
  'You explain automated fraud-risk flags for a peer-to-peer payments platform, for a ' +
  'compliance reviewer. Given a deterministic rule-based score and the specific signals ' +
  'that fired, write exactly one short, neutral, factual sentence (max 220 characters) ' +
  'describing the pattern that was detected. Never accuse the account holder of ' +
  'wrongdoing, never speculate beyond the given signals, and do not repeat the signal ' +
  'text verbatim — synthesize it into plain language.';

export interface RiskExplanationInput {
  score: number;
  level: string;
  reasons: string[];
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Optional plain-language gloss on a HIGH-risk transfer, via OpenAI's Chat
 * Completions API. Every part of the risk engine's actual decision — score,
 * level, reasons, the audit record — already exists without this; it purely
 * adds a sentence a non-technical reviewer can read. With no API key
 * configured, `explainRisk` returns null and nothing else in the app changes
 * behavior.
 */
@Injectable()
export class AiExplanationService {
  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.openaiApiKey);
  }

  /** Throws on a network/API failure so the caller can log and drop it — never retried. */
  async explainRisk(input: RiskExplanationInput): Promise<string | null> {
    const apiKey = this.config.openaiApiKey;
    if (!apiKey) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.openaiModel ?? DEFAULT_MODEL,
          max_tokens: 150,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Risk score: ${input.score} (${input.level}). Signals detected: ${input.reasons.join('; ')}.`,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API responded with ${response.status}`);
      }

      const body = (await response.json()) as OpenAiChatCompletionResponse;
      const text = body.choices?.[0]?.message?.content;
      return text ? text.trim().slice(0, MAX_EXPLANATION_LENGTH) : null;
    } finally {
      clearTimeout(timer);
    }
  }
}
