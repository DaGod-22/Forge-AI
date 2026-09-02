# Forge AI

Forge AI is a browser-based control surface for real software/game project workspaces. It provides project files, terminal execution, preview/publish, QA, Git/GitHub, integration credentials, Supabase migration tooling, and an AI-agent router that refuses to run without a genuine model provider.

## Important anti-fake-AI behavior

Forge no longer includes a deterministic/local fake model. If no real model endpoint is configured, the **Build with real AI** action is blocked and explains the limitation. In this Arena sandbox, the conversational coding agent can edit this repository, but the running web app is not automatically given an HTTP API to call that agent. If Arena exposes one later, configure `ARENA_AGENT_ENDPOINT`/`ARENA_AI_ENDPOINT`; otherwise use `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

The included **verified starter builders** are explicitly non-AI. They exist so preview, publish, auth, full-stack behavior, tests, and game mechanics can be validated immediately without pretending a model generated them.

## What is implemented

- **Cleaner Forge UI** focused on building, previewing, publishing, inspecting files, running QA, managing integrations, Git, and database migrations.
- **Real project workspaces** under `workspace/projects` with editable source files, package manifests, tests, docs, migrations, and assets.
- **Real AI provider router** for Arena-native endpoint, GitHub Models (optional existing GitHub auth), Anthropic, and OpenAI-compatible APIs. No local deterministic fallback.
- **Model-driven task engine** that, when a real provider is configured, asks the model for concrete file patches/commands, writes the actual project filesystem, runs real QA, asks the model to repair failures, and only reports success when checks pass.
- **Verified full-stack auth starter** with React UI, Express backend, password hashing via Node crypto, HttpOnly session cookies, protected APIs, local persistent development storage, Supabase-ready data adapter, and tests.
- **Verified game starter** with Canvas/TypeScript loop, procedural dungeon, movement, collision, enemy AI, combat, loot, progression, local saves, SVG pixel-art spritesheet, and tests.
- **Requirement tracking and durable memory** stored in `.forge`.
- **Project indexing/search** without loading whole repositories into model context.
- **Filesystem operations** for listing, reading, writing, deleting, checkpointing, and restoring project files with path traversal guards.
- **Terminal execution** scoped to project roots with a safe command allow-list and secret redaction.
- **Live preview process manager** that installs dependencies when needed and starts real project dev servers on sandbox-visible ports.
- **Arena publish** that runs QA and starts a real shareable preview URL in the Arena/E2B environment.
- **Browser automation hook** using Playwright/Chromium when available; reports blocked instead of faking when unavailable.
- **Quality gates** running install, typecheck, lint, tests, production build, audit, and optional HTTP smoke checks.
- **Git/GitHub support** using real `git`/`gh`: init, status, diffs, branches, commits, push, pull, repository import, repository creation, and pull request creation when authenticated.
- **Integration Hub** registry for GitHub, Vercel, Supabase, Stripe, Resend, S3-compatible storage, and custom APIs.
- **Encrypted secrets manager** using AES-256-GCM with local gitignored master key or `FORGE_MASTER_KEY`.
- **Supabase integration** for real migration application/schema inspection when `SUPABASE_DB_URL` is connected, plus Storage bucket creation with service-role credentials.
- **Vercel deployment pipeline** using the real Vercel CLI when `VERCEL_TOKEN` is connected; blocks rather than generating fake deployment URLs.

## Run locally

```bash
npm install
npm run dev
```

Open Forge at `http://localhost:5173`.

## Validate

```bash
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

## Configuration

Copy `.env.example` to `.env.local` (Forge loads `.env.local` and `.env`) or set environment variables in your deployment environment. Never commit real secrets.

Useful values:

- `ARENA_AGENT_ENDPOINT` / `ARENA_AI_ENDPOINT` — optional native Arena model endpoint if available in the hosting environment.
- `GITHUB_MODELS_ENABLE=1` / `GITHUB_MODELS_MODEL` — enables GitHub Models using the existing GitHub token only when the endpoint is reachable.
- `OPENAI_API_KEY` / `OPENAI_MODEL` — enables OpenAI-compatible model-backed implementation.
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` — enables Anthropic model-backed implementation.
- `FORGE_MASTER_KEY` — master key for secret encryption. If omitted, Forge creates `.forge/secrets/master.key` locally.
- `VERCEL_TOKEN` — enables actual Vercel deployments after QA passes.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` — enable real Supabase operations.

## Security notes

Forge confines project operations to the configured workspace, redacts common secret patterns from command output, stores integration credentials encrypted, ignores `.data` and secret files from indexing, and prevents service-role/secret key values from being returned to the frontend. Deployment and integration operations intentionally block instead of pretending to succeed when credentials or checks are missing.
