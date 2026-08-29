import { Injectable, Logger } from '@nestjs/common';
import type { ClaimedOutboxEvent } from '../outbox/outbox.repository';
import { AiExplanationService } from './ai-explanation.service';
import { RiskRepository } from './risk.repository';

/** Only outbox events of this type are ever considered. */
const RISK_FLAGGED_EVENT_TYPE = 'transfer.risk_flagged';

/**
 * Best-effort follow-up for a `transfer.risk_flagged` event: asks the
 * (optional) AI explanation service for one plain-language sentence and
 * attaches it to the already-committed risk assessment.
 *
 * Deliberately NOT run inside OutboxProcessor's claim/dispatch transaction —
 * see `OutboxProcessor.processNext`. `tryExplain` is called after that
 * transaction has committed, on its own connection, and never throws: the
 * deterministic score/level/reasons are already durable and authoritative,
 * so a failed or skipped explanation is a fully acceptable outcome, not a
 * reason to retry the outbox event.
 */
@Injectable()
export class RiskExplanationConsumer {
  private readonly logger = new Logger(RiskExplanationConsumer.name);

  constructor(
    private readonly ai: AiExplanationService,
    private readonly risk: RiskRepository,
  ) {}

  async tryExplain(event: ClaimedOutboxEvent): Promise<void> {
    if (event.eventType !== RISK_FLAGGED_EVENT_TYPE || !this.ai.isConfigured()) {
      return;
    }

    try {
      const payload = event.payload as { score: number; level: string; reasons: string[] };
      const explanation = await this.ai.explainRisk(payload);
      if (explanation) {
        await this.risk.setExplanation(event.aggregateId, explanation);
      }
    } catch (error) {
      this.logger.warn(
        `Could not generate a risk explanation for transfer ${event.aggregateId}: ${(error as Error).message}`,
      );
    }
  }
}
