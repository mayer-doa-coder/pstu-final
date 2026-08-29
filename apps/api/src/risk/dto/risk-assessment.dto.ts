import type { RiskLevel } from '@prisma/client';

/** Surfaced on a transfer's own detail response — visible only to its participants. */
export interface RiskAssessmentDto {
  score: number;
  level: RiskLevel;
  reasons: string[];
  /** Plain-language gloss from the optional LLM step; null until produced (HIGH only) or if never configured. */
  explanation: string | null;
}
