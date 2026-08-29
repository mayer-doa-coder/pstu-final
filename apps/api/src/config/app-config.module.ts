import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

// npm workspaces run a package's scripts with that package's own directory as
// `process.cwd()` — so `npm run start:dev --workspace apps/api` (the README's
// documented local-dev command) sees cwd `apps/api`, not the repo root. The
// default `.env` lookup (relative to cwd) therefore never finds the root
// `.env` the README has contributors create, and boot fails with "Invalid
// environment configuration" even though `.env` exists one level up.
//
// This file lives at apps/api/src/config (and, compiled, at
// apps/api/dist/config — nest-cli mirrors src/ 1:1 under dist/), so the repo
// root is always 4 directories up from here regardless of which one is
// running.
const REPO_ROOT_ENV_FILE = resolve(__dirname, '..', '..', '..', '..', '.env');

// Global: typed config is cross-cutting infrastructure. Other global modules
// (e.g. RedisModule) inject AppConfigService without importing this module,
// so it must be available application-wide, not only where it's imported.
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Checked in order; real process env vars (Docker, CI, a test's own
      // `process.env.X = …`) always win over either file — dotenv only fills
      // in variables that aren't already set (@nestjs/config's
      // `assignVariablesToProcess`), so this is a pure fallback and can never
      // override an explicitly-configured environment.
      envFilePath: ['.env', REPO_ROOT_ENV_FILE],
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
