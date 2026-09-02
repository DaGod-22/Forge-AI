import fs from 'node:fs';
import path from 'node:path';
import { checkpointsRoot, indexesRoot, workspaceRoot } from '../config.js';
import { store } from '../store.js';
import {
  CheckpointRecord,
  DecisionRecord,
  FileEntry,
  FileNode,
  MemoryRecord,
  ProjectKind,
  ProjectRecord,
  RequirementRecord,
  SearchResult
} from '../../shared/types.js';
import {
  assertProjectRoot,
  createId,
  ignoredDirectoryNames,
  nowIso,
  redactSecrets,
  relativeToProject,
  safeJoin,
  shouldIgnorePath,
  slugify
} from '../security.js';

const PROJECTS_TABLE = 'projects';
const REQUIREMENTS_TABLE = 'requirements';
const MEMORY_TABLE = 'memory';
const DECISIONS_TABLE = 'decisions';
const CHECKPOINTS_TABLE = 'checkpoints';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.css',
  '.html',
  '.sql',
  '.yml',
  '.yaml',
  '.txt',
  '.env.example',
  '.gitignore'
]);

export interface CreateProjectInput {
  name: string;
  description?: string;
  kind?: ProjectKind;
}

export class ProjectService {
  listProjects() {
    return store.read<ProjectRecord[]>(PROJECTS_TABLE, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(projectId: string) {
    const project = this.listProjects().find((item) => item.id === projectId);
    if (!project) throw new Error(`Unknown project ${projectId}`);
    assertProjectRoot(project.rootPath);
    return project;
  }

  createProject(input: CreateProjectInput) {
    const createdAt = nowIso();
    const slugBase = slugify(input.name);
    let slug = slugBase;
    let suffix = 2;
    const existing = this.listProjects();
    while (existing.some((project) => project.slug === slug)) slug = `${slugBase}-${suffix++}`;
    const projectRoot = path.join(workspaceRoot, slug);
    fs.mkdirSync(projectRoot, { recursive: true });
    const project: ProjectRecord = {
      id: createId('project'),
      name: input.name,
      slug,
      kind: input.kind || 'web',
      rootPath: projectRoot,
      description: input.description || '',
      status: 'planning',
      techStack: [],
      createdAt,
      updatedAt: createdAt
    };
    store.write(PROJECTS_TABLE, [project, ...existing]);
    this.addMemory(project.id, 'architecture', 'Project initialized', `Workspace created at ${projectRoot}.`, ['project', 'workspace']);
    return project;
  }

  updateProject(projectId: string, patch: Partial<ProjectRecord>) {
    const updatedAt = nowIso();
    let updated: ProjectRecord | undefined;
    store.update<ProjectRecord[]>(PROJECTS_TABLE, [], (projects) =>
      projects.map((project) => {
        if (project.id !== projectId) return project;
        updated = { ...project, ...patch, id: project.id, rootPath: project.rootPath, updatedAt };
        return updated;
      })
    );
    if (!updated) throw new Error(`Unknown project ${projectId}`);
    return updated;
  }

  listRequirements(projectId: string) {
    return store.read<RequirementRecord[]>(REQUIREMENTS_TABLE, []).filter((record) => record.projectId === projectId);
  }

  saveRequirements(records: RequirementRecord[]) {
    const all = store.read<RequirementRecord[]>(REQUIREMENTS_TABLE, []);
    const ids = new Set(records.map((record) => record.id));
    const next = all.filter((record) => !ids.has(record.id)).concat(records);
    store.write(REQUIREMENTS_TABLE, next);
    return records;
  }

  updateRequirement(requirementId: string, patch: Partial<RequirementRecord>) {
    let updated: RequirementRecord | undefined;
    store.update<RequirementRecord[]>(REQUIREMENTS_TABLE, [], (records) =>
      records.map((record) => {
        if (record.id !== requirementId) return record;
        updated = { ...record, ...patch, id: record.id, updatedAt: nowIso() };
        return updated;
      })
    );
    if (!updated) throw new Error(`Unknown requirement ${requirementId}`);
    return updated;
  }

  addMemory(projectId: string, category: MemoryRecord['category'], title: string, body: string, tags: string[] = []) {
    const timestamp = nowIso();
    const record: MemoryRecord = {
      id: createId('mem'),
      projectId,
      category,
      title,
      body,
      tags,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.update<MemoryRecord[]>(MEMORY_TABLE, [], (records) => [record, ...records]);
    return record;
  }

  listMemory(projectId: string) {
    return store.read<MemoryRecord[]>(MEMORY_TABLE, []).filter((record) => record.projectId === projectId);
  }

  addDecision(projectId: string, title: string, rationale: string, consequences: string[]) {
    const record: DecisionRecord = {
      id: createId('decision'),
      projectId,
      title,
      rationale,
      consequences,
      createdAt: nowIso()
    };
    store.update<DecisionRecord[]>(DECISIONS_TABLE, [], (records) => [record, ...records]);
    return record;
  }

  listDecisions(projectId: string) {
    return store.read<DecisionRecord[]>(DECISIONS_TABLE, []).filter((record) => record.projectId === projectId);
  }

  listFiles(projectId: string, relativePath = '.', depth = 5): FileNode[] {
    const project = this.getProject(projectId);
    const base = safeJoin(project.rootPath, relativePath);
    if (!fs.existsSync(base)) return [];
    return this.readDirectory(project.rootPath, base, depth);
  }

  private readDirectory(projectRoot: string, absolutePath: string, depth: number): FileNode[] {
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true }).filter((entry) => !shouldIgnorePath(entry.name));
    return entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 300)
      .map((entry) => {
        const fullPath = path.join(absolutePath, entry.name);
        const rel = relativeToProject(projectRoot, fullPath);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: rel,
            type: 'directory',
            children: depth > 0 ? this.readDirectory(projectRoot, fullPath, depth - 1) : []
          } satisfies FileNode;
        }
        const stat = fs.statSync(fullPath);
        return { name: entry.name, path: rel, type: 'file', size: stat.size } satisfies FileNode;
      });
  }

  readFile(projectId: string, relativePath: string): FileEntry {
    const project = this.getProject(projectId);
    const filePath = safeJoin(project.rootPath, relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`File not found: ${relativePath}`);
    if (!this.isTextFile(filePath)) throw new Error(`Refusing to read non-text file through code editor: ${relativePath}`);
    const stat = fs.statSync(filePath);
    return {
      path: relativeToProject(project.rootPath, filePath),
      content: redactSecrets(fs.readFileSync(filePath, 'utf8')),
      encoding: 'utf8',
      updatedAt: stat.mtime.toISOString()
    };
  }

  writeFile(projectId: string, relativePath: string, content: string) {
    const project = this.getProject(projectId);
    const filePath = safeJoin(project.rootPath, relativePath);
    this.createCheckpoint(projectId, `Before editing ${relativePath}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    this.updateProject(projectId, { status: 'needs-testing' });
    this.addMemory(projectId, 'feature', `Edited ${relativePath}`, `Forge wrote ${content.length} characters to ${relativePath}.`, ['file']);
    return this.readFile(projectId, relativePath);
  }

  deletePath(projectId: string, relativePath: string) {
    const project = this.getProject(projectId);
    const target = safeJoin(project.rootPath, relativePath);
    if (!fs.existsSync(target)) return { deleted: false };
    this.createCheckpoint(projectId, `Before deleting ${relativePath}`);
    fs.rmSync(target, { recursive: true, force: true });
    this.updateProject(projectId, { status: 'needs-testing' });
    this.addMemory(projectId, 'feature', `Deleted ${relativePath}`, `Forge deleted ${relativePath}.`, ['file']);
    return { deleted: true };
  }

  createCheckpoint(projectId: string, label: string) {
    const project = this.getProject(projectId);
    const timestamp = nowIso();
    const id = createId('checkpoint');
    const checkpointPath = path.join(checkpointsRoot, projectId, id);
    fs.mkdirSync(checkpointPath, { recursive: true });
    let files = 0;
    this.copyProjectTree(project.rootPath, checkpointPath, () => {
      files += 1;
    });
    const record: CheckpointRecord = {
      id,
      projectId,
      label,
      path: checkpointPath,
      files,
      createdAt: timestamp
    };
    store.update<CheckpointRecord[]>(CHECKPOINTS_TABLE, [], (records) => [record, ...records]);
    return record;
  }

  listCheckpoints(projectId: string) {
    return store.read<CheckpointRecord[]>(CHECKPOINTS_TABLE, []).filter((record) => record.projectId === projectId);
  }

  restoreCheckpoint(projectId: string, checkpointId: string) {
    const project = this.getProject(projectId);
    const checkpoint = this.listCheckpoints(projectId).find((item) => item.id === checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint ${checkpointId}`);
    this.createCheckpoint(projectId, `Before restoring ${checkpointId}`);
    for (const entry of fs.readdirSync(project.rootPath)) {
      if (ignoredDirectoryNames.has(entry)) continue;
      fs.rmSync(path.join(project.rootPath, entry), { recursive: true, force: true });
    }
    this.copyProjectTree(checkpoint.path, project.rootPath);
    this.updateProject(projectId, { status: 'needs-testing' });
    return checkpoint;
  }

  private copyProjectTree(source: string, dest: string, onFile?: () => void) {
    if (!fs.existsSync(source)) return;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (shouldIgnorePath(entry.name)) continue;
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.copyProjectTree(sourcePath, destPath, onFile);
      } else if (entry.isFile()) {
        const stat = fs.statSync(sourcePath);
        if (stat.size > 2_000_000) continue;
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(sourcePath, destPath);
        onFile?.();
      }
    }
  }

  indexProject(projectId: string) {
    const project = this.getProject(projectId);
    const files: { path: string; content: string; modifiedAt: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (shouldIgnorePath(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile() || !this.isTextFile(fullPath)) continue;
        const stat = fs.statSync(fullPath);
        if (stat.size > 300_000) continue;
        files.push({
          path: relativeToProject(project.rootPath, fullPath),
          content: fs.readFileSync(fullPath, 'utf8').slice(0, 40_000),
          modifiedAt: stat.mtime.toISOString()
        });
      }
    };
    walk(project.rootPath);
    fs.mkdirSync(indexesRoot, { recursive: true });
    const indexPath = path.join(indexesRoot, `${projectId}.json`);
    fs.writeFileSync(indexPath, JSON.stringify({ projectId, indexedAt: nowIso(), files }, null, 2));
    this.addMemory(projectId, 'architecture', 'Project indexed', `Indexed ${files.length} text files for retrieval.`, ['index', 'search']);
    return { indexedFiles: files.length, indexedAt: nowIso() };
  }

  searchProject(projectId: string, query: string): SearchResult[] {
    const indexPath = path.join(indexesRoot, `${projectId}.json`);
    if (!fs.existsSync(indexPath)) this.indexProject(projectId);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { files: { path: string; content: string }[] };
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2);
    return index.files
      .map((file) => {
        const lower = file.content.toLowerCase();
        const score = terms.reduce((acc, term) => acc + (lower.includes(term) ? 1 : 0), 0);
        const firstTerm = terms.find((term) => lower.includes(term));
        const pos = firstTerm ? Math.max(0, lower.indexOf(firstTerm) - 120) : 0;
        return {
          path: file.path,
          score,
          excerpt: redactSecrets(file.content.slice(pos, pos + 360).replace(/\s+/g, ' '))
        };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }

  private isTextFile(filePath: string) {
    const basename = path.basename(filePath);
    if (TEXT_EXTENSIONS.has(basename)) return true;
    return TEXT_EXTENSIONS.has(path.extname(filePath));
  }
}

export const projectService = new ProjectService();
