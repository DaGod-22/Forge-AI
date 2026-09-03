# Forge AI

Forge AI is an AI-first builder for **websites, web apps, and playable browser games**.

## What works

- Natural-language generation for websites, apps and games
- Real AI coding through any OpenAI-compatible chat-completions provider
- Built-in functional generator when no API key is configured
- Live sandboxed HTML preview
- Editable generated source
- Iterative "Improve current" generation using existing project context
- Local project persistence in the browser
- Save directly to a local folder when the browser supports the File System Access API
- Export generated files as a text bundle
- Path and size validation on AI-generated files

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Enable the AI coder

Copy `.env.example` to `.env.local` and set `AI_API_KEY`, `AI_BASE_URL`, and `AI_MODEL`. The provider must expose an OpenAI-compatible `/chat/completions` endpoint.

## Architecture

Forge separates generation/editing from preview execution. Generated HTML/JS is previewed in a sandboxed iframe; full generated projects can be saved/exported and run in a real development environment. This is the foundation for adding isolated remote build sandboxes later.
