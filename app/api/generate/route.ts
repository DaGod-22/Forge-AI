import { NextResponse } from 'next/server';
import { templateProject, type ForgeFile, type ProjectType } from '../../../lib/templates';

const MAX_FILES = 30;
const MAX_FILE_BYTES = 120_000;

function cleanFiles(value: unknown): ForgeFile[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FILES).flatMap((f: any) => {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') return [];
    const path = f.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path || path.includes('..') || path.startsWith('.') || path.includes('\0')) return [];
    return [{ path, content: f.content.slice(0, MAX_FILE_BYTES) }];
  });
}

async function llmGenerate(prompt: string, type: ProjectType, existingFiles: ForgeFile[]) {
  const key = process.env.AI_API_KEY;
  const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  if (!key) return null;
  const system = `You are Forge AI, a senior full-stack engineer and game developer. Generate production-quality code, not a mockup. Project type: ${type}. Return ONLY valid JSON with keys files (array of {path,content}), previewHtml (string), summary (string). Keep paths relative. Include every file required for the requested result. For websites/apps favor accessible responsive HTML/CSS/JS or Next.js-compatible code. For games make the game genuinely playable with a loop, controls, UI and progression. When editing an existing project, preserve working functionality and make the requested change. Never include markdown fences.`;
  const context = existingFiles.length ? `\nEXISTING FILES:\n${existingFiles.map(f => `--- ${f.path}\n${f.content}`).join('\n').slice(0, 300000)}` : '';
  const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt + context }] }) });
  if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new Error('AI provider returned no text');
  const parsed = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,''));
  const files = cleanFiles(parsed.files);
  if (!files.length) throw new Error('AI generated no valid files');
  return { files, previewHtml: typeof parsed.previewHtml === 'string' ? parsed.previewHtml.slice(0, 200000) : files.find(f => f.path === 'index.html')?.content || '', summary: typeof parsed.summary === 'string' ? parsed.summary : 'Generated project.' };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const type = ['website','app','game'].includes(body.type) ? body.type as ProjectType : 'website';
    const existingFiles = cleanFiles(body.existingFiles);
    if (!prompt) return NextResponse.json({ error: 'Describe what you want to build.' }, { status: 400 });
    const generated = await llmGenerate(prompt, type, existingFiles);
    if (generated) return NextResponse.json({ ...generated, mode: 'ai' });
    const fallback = templateProject(type, prompt);
    return NextResponse.json({ ...fallback, mode: 'template', notice: 'No AI provider is configured, so Forge used its built-in functional generator. Add AI_API_KEY to enable autonomous coding.' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Generation failed.' }, { status: 500 });
  }
}