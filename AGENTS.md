# AGENTS.md

This file is for coding agents working in this repository.
It documents how to build/check the project and how to match local coding conventions.

## Project Snapshot

- Stack: Next.js App Router + React 19 + TypeScript + Tailwind CSS 4.
- Runtime: Node.js `>=20.19.0` (`package.json` engines field).
- Package manager: npm (`packageManager: npm@10.9.2`).
- Database layer: Prisma + MariaDB/MySQL (Tencent path) and Supabase (non-Tencent path).
- Path alias: `@/*` -> repository root (see `tsconfig.json`).

## Communication Rule

- Always reply to the user in Chinese.

## High-Value Commands

Run commands from repo root: `/Users/liuzhenyu_macbookpro/Desktop/AI-Translate 2/mvp_29`.

### Install

- `npm install`

### Local dev

- `npm run dev`
- Uses experimental HTTPS certs from `.cert/localhost-key.pem` and `.cert/localhost-cert.pem`.

### Build / production

- `npm run build`
  - Runs `node scripts/adapt-schema.js`
  - Prints Node/npm versions
  - Runs `prisma generate`
  - Runs `next build`
- `npm run start`
- `npm run start:migrate` (runs `prisma db push --accept-data-loss` before start)

### Lint / type checking

- `npm run lint` (eslint across repo)
- `npm run typecheck` (`tsc --noEmit`)

### Prisma / schema tasks

- `npx prisma generate`
- `npx prisma db push`

## Single-Test Guidance (Important)

There is currently no automated test framework configured in this repo:

- No `test` script in `package.json`.
- No detected `*.test.*` / `*.spec.*` files.
- No detected Jest/Vitest/Playwright/Cypress config.

So "run a single test" is currently **not available** as a native project command.

When you need focused verification, use these targeted checks instead:

- Single file lint: `npx eslint app/api/translate/route.ts`
- Single folder lint: `npx eslint app/api`
- Full type safety pass: `npm run typecheck`
- Manual route smoke-check (dev server running):
  - `curl -X POST http://localhost:3000/api/translate -H 'content-type: application/json' -d '{"text":"hello","sourceLanguage":"English","targetLanguage":"Chinese"}'`

If you introduce a real test runner, add scripts and update this file with exact single-test syntax.

## Repo Structure (Working Mental Model)

- `app/`: App Router pages, route handlers, server actions.
- `components/`: Client/server React components, including `components/ui/*`.
- `hooks/`: Reusable React hooks.
- `lib/`: Shared utilities, data clients, i18n, rate limiting, store abstractions.
- `prisma/`: Prisma schema.
- `scripts/`: Build-time helpers (e.g. schema adaptation for deploy target).
- `rules/`: CloudBase rule/skill docs for specialized workflows.

## Code Style Guidelines

Follow existing file-local style first; this repo has some legacy inconsistencies.
Avoid broad formatting churn in unrelated lines.

### Imports

- Prefer absolute imports via `@/` for internal modules.
- Keep Node built-ins explicit (`node:crypto`, `node:path`, `node:fs`).
- Use `import type` / inline `type` imports for type-only symbols.
- Group imports logically: framework/external -> internal aliases -> relative imports.
- Do not reorder imports aggressively in touched files unless necessary.

### Formatting

- Use 2-space indentation (TypeScript/TSX/CSS).
- Match quote style of the file you are editing (single and double both exist).
- Keep semicolon usage consistent with surrounding file (both styles exist).
- Prefer trailing commas in multiline objects/arrays/args where already used.
- Keep lines readable; split long calls/objects into multiline form.

### TypeScript and Types

- `strict` mode is enabled; do not bypass with `any` unless truly unavoidable.
- Prefer narrow unions and explicit object shapes over loose records.
- Use `unknown` in catch/error boundaries; narrow before reading fields.
- Preserve runtime validation for external input (`req.json()`, query params, env values).
- Return concrete types from helpers where practical.

### Naming

- React components: PascalCase (`VoiceChatInterface`).
- Hooks: `useXxx` naming (`useTextToSpeech`).
- Utility functions/variables: camelCase.
- Constants: UPPER_SNAKE_CASE for module-level immutable values.
- Route handlers: exported `GET`/`POST`/etc in `app/api/**/route.ts`.

### React / Next.js conventions

- Add `"use client"` only for true client components.
- Prefer server components by default when client features are not needed.
- Keep side effects in hooks, memoize expensive derivations when useful.
- Use Next primitives consistently (`NextRequest`, `NextResponse`, `revalidatePath`).
- Keep API responses JSON-based and stable for frontend callers.

### Error handling and logging

- Wrap route handlers and server actions in `try/catch`.
- Log actionable context via `console.error("[Context] ...", error)`.
- Return user-safe error payloads (avoid leaking secrets/internal stack traces).
- Use status codes intentionally (`400` input, `401/403` auth, `500` server failures).
- Prefer early returns for validation and guard clauses.

### Data and persistence

- Use `getPrisma()` / existing data helpers rather than creating ad-hoc clients.
- Respect dual backend behavior (Tencent vs non-Tencent) already present in code.
- For schema changes, update `prisma/schema.prisma` and regenerate client.
- Keep `_openid` compatibility behavior intact where present.

### Environment and secrets

- Never hardcode API keys, secrets, or tokens.
- Read env via existing resolver/helper patterns when available.
- Validate required env values and fail with clear errors.
- Do not print secrets in logs.

## Rule Files / Agent Instructions

Checked for standard AI instruction files:

- `.cursor/rules/`: not found
- `.cursorrules`: not found
- `.github/copilot-instructions.md`: not found

Additional project-specific guidance exists under `rules/**` (CloudBase skill docs).
When tasks touch CloudBase/auth/functions/storage/modeling, review relevant files there.

## PR/Change Hygiene for Agents

- Keep changes scoped; avoid unrelated refactors.
- Update docs when behavior/commands change.
- Run lint and typecheck before finalizing substantial code changes.
- For risky data-path edits, include a manual verification note in your handoff.
