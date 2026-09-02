import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { commandLogsRoot } from '../config.js';
import { CommandResult } from '../../shared/types.js';
import { createId, nowIso, redactSecrets, safeJoin, validateShellCommand } from '../security.js';

const execAsync = promisify(exec);

export interface RunCommandOptions {
  cwd: string;
  command: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  allowFailure?: boolean;
}

export async function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  const id = createId('cmd');
  const command = validateShellCommand(options.command);
  const cwd = safeJoin(options.cwd, '.');
  const startedAt = nowIso();
  let exitCode: number | null = 0;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  try {
    const result = await execAsync(command, {
      cwd,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) }
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number | string; killed?: boolean; signal?: string };
    stdout = err.stdout || '';
    stderr = err.stderr || err.message;
    timedOut = Boolean(err.killed && err.signal === 'SIGTERM');
    exitCode = typeof err.code === 'number' ? err.code : timedOut ? 124 : 1;
    if (!options.allowFailure) {
      // Do not throw yet; return structured failure so the agent can debug and report.
    }
  }
  const finishedAt = nowIso();
  const record: CommandResult = {
    id,
    command,
    cwd,
    exitCode,
    stdout: redactSecrets(stdout).slice(-100_000),
    stderr: redactSecrets(stderr).slice(-100_000),
    startedAt,
    finishedAt,
    timedOut
  };
  fs.mkdirSync(commandLogsRoot, { recursive: true });
  fs.writeFileSync(path.join(commandLogsRoot, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

export async function commandExists(binary: string) {
  const result = await runCommand({ cwd: process.cwd(), command: `which ${binary}`, timeoutMs: 10_000, allowFailure: true });
  return result.exitCode === 0;
}
