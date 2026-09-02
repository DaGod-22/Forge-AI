import type {
  AgentTask,
  CheckpointRecord,
  CommandResult,
  DatabaseTable,
  DecisionRecord,
  DeploymentRecord,
  FileEntry,
  FileNode,
  IntegrationConnection,
  IntegrationDefinition,
  MemoryRecord,
  ProcessLog,
  ProjectKind,
  ProjectRecord,
  QualityGateReport,
  RequirementRecord,
  SearchResult,
  SecretReference
} from '../shared/types';

export interface ForgeConfig {
  stateRoot: string;
  workspaceRoot: string;
  version: string;
  nodeEnv: string;
  capabilities: Record<string, boolean>;
  providers: { id: string; label?: string; supports: string[]; configured: boolean; limitation?: string }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body as T;
}

export const forgeApi = {
  config: () => request<ForgeConfig>('/api/config'),
  listProjects: () => request<ProjectRecord[]>('/api/projects'),
  createProject: (payload: { name: string; description?: string; kind?: ProjectKind; instruction?: string }) =>
    request<{ project: ProjectRecord; task?: AgentTask }>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }),
  project: (projectId: string) => request<ProjectRecord>(`/api/projects/${projectId}`),
  requirements: (projectId: string) => request<RequirementRecord[]>(`/api/projects/${projectId}/requirements`),
  memory: (projectId: string) => request<MemoryRecord[]>(`/api/projects/${projectId}/memory`),
  decisions: (projectId: string) => request<DecisionRecord[]>(`/api/projects/${projectId}/decisions`),
  checkpoints: (projectId: string) => request<CheckpointRecord[]>(`/api/projects/${projectId}/checkpoints`),
  files: (projectId: string) => request<FileNode[]>(`/api/projects/${projectId}/files`),
  readFile: (projectId: string, path: string) => request<FileEntry>(`/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  writeFile: (projectId: string, path: string, content: string) =>
    request<FileEntry>(`/api/projects/${projectId}/file`, { method: 'PUT', body: JSON.stringify({ path, content }) }),
  search: (projectId: string, query: string) => request<SearchResult[]>(`/api/projects/${projectId}/search`, { method: 'POST', body: JSON.stringify({ query }) }),
  runAgent: (projectId: string, instruction: string) =>
    request<AgentTask>(`/api/projects/${projectId}/agent`, { method: 'POST', body: JSON.stringify({ instruction }) }),
  buildStarter: (projectId: string, instruction: string, kind?: ProjectKind) =>
    request<AgentTask>(`/api/projects/${projectId}/starter`, { method: 'POST', body: JSON.stringify({ instruction, kind }) }),
  tasks: (projectId: string) => request<AgentTask[]>(`/api/projects/${projectId}/tasks`),
  terminal: (projectId: string, command: string) =>
    request<CommandResult>(`/api/projects/${projectId}/terminal`, { method: 'POST', body: JSON.stringify({ command }) }),
  qa: (projectId: string, install = false) =>
    request<QualityGateReport>(`/api/projects/${projectId}/qa`, { method: 'POST', body: JSON.stringify({ install }) }),
  browserTest: (projectId: string, url?: string) =>
    request<{ id: string; status: 'passed' | 'failed' | 'blocked'; url: string; title?: string; screenshotPath?: string; console: string[]; networkFailures: string[]; errors: string[] }>(`/api/projects/${projectId}/browser-test`, { method: 'POST', body: JSON.stringify({ url }) }),
  startPreview: (projectId: string) => request<ProcessLog>(`/api/projects/${projectId}/preview/start`, { method: 'POST' }),
  process: (processId: string) => request<ProcessLog>(`/api/processes/${processId}`),
  stopProcess: (processId: string) => request<ProcessLog>(`/api/processes/${processId}/stop`, { method: 'POST' }),
  integrations: () => request<IntegrationDefinition[]>('/api/integrations'),
  connections: () => request<IntegrationConnection[]>('/api/integrations/connections'),
  secrets: () => request<SecretReference[]>('/api/integrations/secrets'),
  connectIntegration: (payload: { integrationId: string; environment?: string; credentials: Record<string, string> }) =>
    request<IntegrationConnection>('/api/integrations/connections', { method: 'POST', body: JSON.stringify(payload) }),
  databaseTables: (projectId: string) => request<DatabaseTable[]>(`/api/projects/${projectId}/database/tables`),
  createTable: (projectId: string, payload: Partial<DatabaseTable>) =>
    request<{ table: DatabaseTable; migrationPath: string }>(`/api/projects/${projectId}/database/tables`, { method: 'POST', body: JSON.stringify(payload) }),
  applySupabaseMigrations: (projectId: string) =>
    request<{ status: string; appliedMigrations: string[]; output: string }>(`/api/projects/${projectId}/supabase/apply-migrations`, { method: 'POST', body: JSON.stringify({ environment: 'development' }) }),
  inspectSupabaseSchema: () => request<{ status: string; tables: unknown[]; policies: unknown[]; output: string }>('/api/supabase/schema'),
  migrations: (projectId: string) => request<{ path: string; content: string }[]>(`/api/projects/${projectId}/database/migrations`),
  gitStatus: (projectId: string) => request<{ status: CommandResult; branch: string; log: string }>(`/api/projects/${projectId}/git/status`),
  gitDiff: (projectId: string) => request<CommandResult>(`/api/projects/${projectId}/git/diff`),
  gitCommit: (projectId: string, message: string) =>
    request<{ add: CommandResult; commit: CommandResult }>(`/api/projects/${projectId}/git/commit`, { method: 'POST', body: JSON.stringify({ message }) }),
  createBranch: (projectId: string, branch: string) =>
    request<CommandResult>(`/api/projects/${projectId}/git/branch`, { method: 'POST', body: JSON.stringify({ branch }) }),
  switchBranch: (projectId: string, branch: string) =>
    request<CommandResult>(`/api/projects/${projectId}/git/switch`, { method: 'POST', body: JSON.stringify({ branch }) }),
  importGithubRepo: (projectId: string, repositoryUrl: string) =>
    request<CommandResult>(`/api/projects/${projectId}/github/import`, { method: 'POST', body: JSON.stringify({ repositoryUrl }) }),
  githubRepos: () => request<CommandResult>('/api/github/repos'),
  push: (projectId: string) => request<CommandResult>(`/api/projects/${projectId}/git/push`, { method: 'POST' }),
  pull: (projectId: string) => request<CommandResult>(`/api/projects/${projectId}/git/pull`, { method: 'POST' }),
  createGithubRepository: (projectId: string, name: string, isPrivate = true) =>
    request<CommandResult>(`/api/projects/${projectId}/github/create-repo`, { method: 'POST', body: JSON.stringify({ name, private: isPrivate }) }),
  createPullRequest: (projectId: string, title: string, body: string) =>
    request<CommandResult>(`/api/projects/${projectId}/github/pr`, { method: 'POST', body: JSON.stringify({ title, body }) }),
  deployVercel: (projectId: string, environment: string) =>
    request<DeploymentRecord>(`/api/projects/${projectId}/deploy/vercel`, { method: 'POST', body: JSON.stringify({ environment }) }),
  publishArena: (projectId: string) => request<DeploymentRecord>(`/api/projects/${projectId}/publish/arena`, { method: 'POST' }),
  deployments: (projectId: string) => request<DeploymentRecord[]>(`/api/projects/${projectId}/deployments`)
};

export function previewUrl(port: number) {
  const { protocol, host } = window.location;
  const match = host.match(/^\d+-(.+)$/);
  if (match) return `${protocol}//${port}-${match[1]}`;
  return `http://localhost:${port}`;
}
