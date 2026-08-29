import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

// Global, like AppConfigModule: RedisService is generic cross-cutting
// infrastructure (rate limiting today), not a business-domain provider that
// individual feature modules should have to import explicitly.
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
