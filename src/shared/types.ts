export type ProjectKind = 'web' | 'saas' | 'api' | 'game' | 'imported';
export type ProjectStatus = 'planning' | 'building' | 'ready' | 'needs-testing' | 'blocked' | 'deployed';
export type EnvironmentName = 'development' | 'preview' | 'production';
export type RequirementStatus = 'completed' | 'in-progress' | 'blocked' | 'needs-testing';
export type TaskStatus = 'queued' | 'running' | 'passed' | 'failed' | 'blocked';
export type AgentRole =
  | 'architect'
  | 'frontend-engineer'
  | 'backend-engineer'
  | 'game-engineer'
  | 'asset-engineer'
  | 'qa-engineer'
  | 'security-engineer'
  | 'performance-engineer';

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  kind: ProjectKind;
  rootPath: string;
  description: string;
  status: ProjectStatus;
  techStack: string[];
  createdAt: string;
  updatedAt: string;
  lastTaskId?: string;
  preview?: PreviewSession;
}

export interface RequirementRecord {
  id: string;
  projectId: string;
  text: string;
  source: string;
  status: RequirementStatus;
  owner: AgentRole;
  evidence?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  projectId: string;
  title: string;
  rationale: string;
  consequences: string[];
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  projectId: string;
  category:
    | 'requirements'
    | 'architecture'
    | 'database'
    | 'api'
    | 'feature'
    | 'bug'
    | 'todo'
    | 'dependency'
    | 'environment'
    | 'deployment'
    | 'qa'
    | 'security'
    | 'performance';
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface FileEntry {
  path: string;
  content: string;
  encoding: 'utf8';
  updatedAt: string;
}

export interface CommandResult {
  id: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  timedOut: boolean;
}

export interface ProcessLog {
  id: string;
  projectId: string;
  name: string;
  command: string;
  cwd: string;
  port?: number;
  status: 'starting' | 'running' | 'exited' | 'failed';
  logs: string[];
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
}

export interface PreviewSession {
  processId: string;
  port: number;
  command: string;
  startedAt: string;
}

export interface TaskStep {
  id: string;
  title: string;
  agent: AgentRole;
  status: TaskStatus;
  details: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AgentTask {
  id: string;
  projectId: string;
  instruction: string;
  status: TaskStatus;
  agents: AgentRole[];
  plan: string[];
  steps: TaskStep[];
  filesChanged: string[];
  commands: CommandResult[];
  qa?: QualityGateReport;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface QualityGateReport {
  id: string;
  projectId: string;
  status: TaskStatus;
  checks: QualityCheck[];
  startedAt: string;
  finishedAt: string;
  summary: string;
}

export interface QualityCheck {
  name: string;
  command?: string;
  status: TaskStatus;
  output: string;
  durationMs: number;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  category:
    | 'source-control'
    | 'deployment'
    | 'database'
    | 'payments'
    | 'email'
    | 'storage'
    | 'analytics'
    | 'communication'
    | 'auth'
    | 'api';
  description: string;
  authMethod: 'oauth' | 'api-key' | 'access-token' | 'connection-string' | 'none';
  requiredCredentials: CredentialDefinition[];
  operations: string[];
  documentationUrl: string;
  scopes: string[];
  secretHandling: string;
}

export interface CredentialDefinition {
  key: string;
  label: string;
  environment: EnvironmentName | 'all';
  secret: boolean;
  required: boolean;
  description: string;
}

export interface IntegrationConnection {
  id: string;
  integrationId: string;
  name: string;
  environments: EnvironmentName[];
  credentialKeys: string[];
  status: 'connected' | 'needs-credentials' | 'error';
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretReference {
  key: string;
  integrationId: string;
  environment: EnvironmentName;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseTableColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  defaultValue?: string;
  references?: { table: string; column: string };
}

export interface DatabaseTable {
  id: string;
  projectId: string;
  name: string;
  description: string;
  columns: DatabaseTableColumn[];
  rlsEnabled: boolean;
  policies: string[];
  indexes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentRecord {
  id: string;
  projectId: string;
  provider: 'vercel' | 'arena' | 'static' | 'custom';
  environment: EnvironmentName;
  status: 'queued' | 'building' | 'ready' | 'failed' | 'blocked';
  url?: string;
  logs: string[];
  checks: QualityCheck[];
  createdAt: string;
  updatedAt: string;
}

export interface CheckpointRecord {
  id: string;
  projectId: string;
  label: string;
  path: string;
  files: number;
  createdAt: string;
}

export interface SearchResult {
  path: string;
  score: number;
  excerpt: string;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}
