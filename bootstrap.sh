#!/usr/bin/env bash
# Quire infrastructure bootstrap. Scaffolds the pnpm + Turborepo layout and root config.
# Usage: ./bootstrap.sh   (run from the repo root; safe to re-run, never overwrites existing files)
set -euo pipefail

write() { # write <path> only if missing
  local path="$1"
  if [[ -e "$path" ]]; then echo "skip  $path"; cat >/dev/null; return; fi
  mkdir -p "$(dirname "$path")"; cat >"$path"; echo "write $path"
}

mkdir -p apps/web apps/api packages/{core,ingest,editing,export,compliance,discovery,tracking,db}/src

write package.json <<'JSON'
{
  "name": "quire",
  "private": true,
  "version": "1.0.0",
  "packageManager": "pnpm@10.28.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write .",
    "db:migrate": "pnpm --filter @quire/db migrate:dev",
    "db:deploy": "pnpm --filter @quire/db migrate:deploy",
    "db:seed": "pnpm --filter @quire/db seed"
  },
  "devDependencies": {
    "@eslint/js": "9.36.0",
    "@types/node": "22.18.6",
    "eslint": "9.36.0",
    "prettier": "3.6.2",
    "turbo": "2.5.8",
    "typescript": "5.9.3",
    "typescript-eslint": "8.44.1",
    "vitest": "3.2.4"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["@prisma/client", "@prisma/engines", "prisma", "esbuild", "argon2", "sharp", "@tailwindcss/oxide"]
  }
}
JSON

write pnpm-workspace.yaml <<'YAML'
packages:
  - apps/*
  - packages/*
YAML

write turbo.json <<'JSON'
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["NODE_ENV", "DATABASE_URL", "ANTHROPIC_API_KEY", "QUIRE_*"],
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": {}
  }
}
JSON

write tsconfig.base.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
JSON

write eslint.config.mjs <<'JS'
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
);
JS

write .prettierrc <<'JSON'
{ "singleQuote": true, "printWidth": 110, "trailingComma": "all" }
JSON

write .prettierignore <<'TXT'
pnpm-lock.yaml
**/.next
**/dist
TXT

write .gitignore <<'TXT'
node_modules
.env
.env.*
!.env.example
dist
.next
.turbo
coverage
*.log
.DS_Store
storage/
TXT

write .npmrc <<'TXT'
auto-install-peers=true
TXT

write .env.example <<'TXT'
# Postgres
DATABASE_URL=postgresql://localhost:5432/quire

# API
QUIRE_API_PORT=4000
QUIRE_WEB_ORIGIN=http://localhost:3000
QUIRE_SESSION_SECRET=change-me-to-32-plus-random-characters
QUIRE_STORAGE_DIR=./storage

# AI (all model calls go through Flint). Leave blank to run rule-only passes.
ANTHROPIC_API_KEY=
QUIRE_MODEL_CHEAP=claude-haiku-4-5
QUIRE_MODEL_STRUCTURAL=claude-sonnet-4-6
# Hard platform-wide daily inference cap, integer cents. Fails closed.
QUIRE_PLATFORM_SPEND_CAP_CENTS_DAILY=2000

# Discovery providers: comma list. "amazon" hits live Amazon autocomplete; "sample" is offline.
QUIRE_DISCOVERY_PROVIDERS=amazon,sample
# Rank provider: "sample" (deterministic, offline) or "amazon-search" (live, off by default).
QUIRE_RANK_PROVIDER=sample

# Web
NEXT_PUBLIC_QUIRE_API_URL=http://localhost:4000
TXT

echo ">> Bootstrap done. Next: pnpm install && cp .env.example .env"
