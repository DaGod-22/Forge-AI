import { ChildProcess, spawn } from 'node:child_process';
import net from 'node:net';
import { ProcessLog } from '../../shared/types.js';
import { createId, nowIso, redactSecrets, safeJoin, validateShellCommand } from '../security.js';

interface ManagedProcess {
  record: ProcessLog;
  child: ChildProcess;
}

const processes = new Map<string, ManagedProcess>();

export function listProcesses(projectId?: string) {
  return Array.from(processes.values())
    .map(({ record }) => record)
    .filter((record) => !projectId || record.projectId === projectId);
}

export function getProcess(processId: string) {
  return processes.get(processId)?.record;
}

export function stopProcess(processId: string) {
  const managed = processes.get(processId);
  if (!managed) throw new Error(`Unknown process ${processId}`);
  managed.child.kill('SIGTERM');
  managed.record.status = 'exited';
  managed.record.exitedAt = nowIso();
  return managed.record;
}

export async function findFreePort(startAt = 4200) {
  for (let port = startAt; port < startAt + 600; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error('No free preview ports available.');
}

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

export interface StartProjectProcessInput {
  projectId: string;
  cwd: string;
  name: string;
  command: string;
  port?: number;
  env?: NodeJS.ProcessEnv;
}

export async function startProjectProcess(input: StartProjectProcessInput) {
  const id = createId('proc');
  const cwd = safeJoin(input.cwd, '.');
  const command = validateShellCommand(input.command);
  const record: ProcessLog = {
    id,
    projectId: input.projectId,
    name: input.name,
    command,
    cwd,
    port: input.port,
    status: 'starting',
    logs: [],
    startedAt: nowIso()
  };
  const child = spawn(command, {
    cwd,
    shell: true,
    env: {
      ...process.env,
      HOST: '0.0.0.0',
      PORT: input.port ? String(input.port) : process.env.PORT,
      API_PORT: input.port ? String(input.port + 1) : process.env.API_PORT,
      ...(input.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const managed: ManagedProcess = { record, child };
  processes.set(id, managed);

  const append = (source: 'stdout' | 'stderr', chunk: Buffer) => {
    const lines = redactSecrets(chunk.toString('utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[${source}] ${line}`);
    record.logs.push(...lines);
    if (record.logs.length > 1000) record.logs.splice(0, record.logs.length - 1000);
    if (record.status === 'starting' && lines.length) record.status = 'running';
  };
  child.stdout?.on('data', (chunk) => append('stdout', chunk));
  child.stderr?.on('data', (chunk) => append('stderr', chunk));
  child.on('exit', (code) => {
    record.status = code === 0 ? 'exited' : 'failed';
    record.exitCode = code;
    record.exitedAt = nowIso();
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (record.status === 'starting') record.status = child.exitCode == null ? 'running' : 'failed';
  return record;
}
