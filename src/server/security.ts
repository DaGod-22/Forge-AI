import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, secretsRoot, workspaceRoot } from './config.js';

export function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || `project-${Date.now()}`;
}

export function createId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeJoin(base: string, requested = '') {
  const target = path.resolve(base, requested || '.');
  const normalizedBase = path.resolve(base);
  if (target !== normalizedBase && !target.startsWith(`${normalizedBase}${path.sep}`)) {
    throw new Error(`Path escapes allowed root: ${requested}`);
  }
  return target;
}

export function relativeToProject(projectRoot: string, absolutePath: string) {
  const rel = path.relative(projectRoot, absolutePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes project root');
  return rel || '.';
}

export function assertProjectRoot(projectRoot: string) {
  const resolved = path.resolve(projectRoot);
  const workspace = path.resolve(workspaceRoot);
  if (resolved === path.resolve(repoRoot)) {
    throw new Error('Forge repository root cannot be treated as a mutable user project.');
  }
  if (!resolved.startsWith(`${workspace}${path.sep}`)) {
    throw new Error('Project is outside the configured Forge workspace.');
  }
}

export const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vite',
  '.parcel-cache',
  '.cache',
  '.forge',
  '.data',
  '__pycache__'
]);

export const sensitiveFileNames = new Set(['.env', '.env.local', '.env.production', '.env.development', '.npmrc']);

export function shouldIgnorePath(entryName: string) {
  return ignoredDirectoryNames.has(entryName) || sensitiveFileNames.has(entryName);
}

export function redactSecrets(text: string) {
  return text
    .replace(/(sk_(live|test)_[A-Za-z0-9_\-]{12,})/g, '[REDACTED_STRIPE_SECRET]')
    .replace(/(ghp_[A-Za-z0-9_]{20,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(eyJ[A-Za-z0-9_\-.]{40,})/g, '[REDACTED_JWT_OR_SECRET]')
    .replace(/((?:SUPABASE|STRIPE|VERCEL|RESEND|AWS|SECRET|TOKEN|KEY)[A-Z0-9_]*\s*=\s*)[^\s]+/gi, '$1[REDACTED]');
}

export function getOrCreateMasterKey() {
  const envKey = process.env.FORGE_MASTER_KEY?.trim();
  if (envKey) return crypto.createHash('sha256').update(envKey).digest();

  fs.mkdirSync(secretsRoot, { recursive: true, mode: 0o700 });
  const keyPath = path.join(secretsRoot, 'master.key');
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(fs.readFileSync(keyPath, 'utf8')).digest();
}

export function encryptSecret(plainText: string) {
  const key = getOrCreateMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload: string) {
  const [ivB64, tagB64, ciphertextB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) throw new Error('Invalid encrypted secret payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getOrCreateMasterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]).toString('utf8');
}

export function fingerprint(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function validateShellCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) throw new Error('Command is empty');
  const first = trimmed.split(/\s+/)[0];
  const allowed = new Set([
    'npm',
    'npx',
    'pnpm',
    'yarn',
    'node',
    'tsx',
    'tsc',
    'vite',
    'git',
    'gh',
    'ls',
    'pwd',
    'cat',
    'grep',
    'find',
    'sed',
    'mkdir',
    'touch',
    'cp',
    'mv',
    'rm',
    'python',
    'python3',
    'pip',
    'pytest',
    'curl',
    'which'
  ]);
  if (!allowed.has(first)) throw new Error(`Command '${first}' is not in Forge's safe command allow-list.`);
  const lower = trimmed.toLowerCase();
  if (lower.includes('rm -rf /') || lower.includes('mkfs') || lower.includes(':(){')) {
    throw new Error('Command blocked by destructive-command guard.');
  }
  if (lower.includes('/home/user/forge-ai/.git') || lower.includes('..')) {
    throw new Error('Command blocked because it may escape the project sandbox.');
  }
  return trimmed;
}
