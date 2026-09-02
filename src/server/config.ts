import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

export const repoRoot = process.cwd();

export const stateRoot = path.resolve(repoRoot, process.env.FORGE_STATE_DIR || '.forge');
export const workspaceRoot = path.resolve(repoRoot, process.env.FORGE_WORKSPACE_DIR || 'workspace/projects');
export const secretsRoot = path.join(stateRoot, 'secrets');
export const checkpointsRoot = path.join(stateRoot, 'checkpoints');
export const indexesRoot = path.join(stateRoot, 'indexes');
export const commandLogsRoot = path.join(stateRoot, 'command-logs');

export function ensureForgeDirectories() {
  for (const dir of [stateRoot, workspaceRoot, secretsRoot, checkpointsRoot, indexesRoot, commandLogsRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function publicConfig() {
  return {
    stateRoot,
    workspaceRoot,
    version: process.env.npm_package_version || '0.1.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    capabilities: {
      localFilesystem: true,
      commandExecution: true,
      git: true,
      githubCli: true,
      vercelCli: true,
      encryptedSecrets: true,
      projectIndexing: true,
      autonomousQa: true,
      previewProcesses: true
    }
  };
}
