import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { verifyNidSchema, type VerifyNidInput } from './dto/verify-nid.schema';
import type { VerificationStatusDto } from './dto/verification-status.dto';
import { VerificationService } from './verification.service';

// Generous enough for a genuine typo-and-retry, tight enough that this can't
// be used to brute-force-guess whether a given NID belongs to someone else.
const VERIFY_RATE_LIMIT = { limit: 10, windowSeconds: 60 };

@UseGuards(JwtAuthGuard)
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @UseGuards(CsrfGuard, RateLimitGuard)
  @RateLimit(VERIFY_RATE_LIMIT)
  @Post('nid')
  submitNid(
    @Body(new ZodValidationPipe(verifyNidSchema)) body: VerifyNidInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VerificationStatusDto> {
    return this.verification.submitNid(user.id, body.nidNumber);
  }
}
