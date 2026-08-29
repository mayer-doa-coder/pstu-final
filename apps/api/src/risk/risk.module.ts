import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AiExplanationService } from './ai-explanation.service';
import { RiskEngineService } from './risk-engine.service';
import { RiskExplanationConsumer } from './risk-explanation.consumer';
import { RiskRepository } from './risk.repository';

/**
 * The deterministic fraud/risk engine and its optional AI explanation
 * follow-up. Imported by TransfersModule (to score a transfer as it settles)
 * and by OutboxModule/WorkerModule (to run the follow-up consumer) — it has
 * no controller and no HTTP surface of its own; risk info is read back
 * through `GET /transfers/:id`.
 */
@Module({
  imports: [DatabaseModule],
  providers: [RiskEngineService, RiskRepository, AiExplanationService, RiskExplanationConsumer],
  exports: [RiskEngineService, RiskRepository, RiskExplanationConsumer],
})
export class RiskModule {}
