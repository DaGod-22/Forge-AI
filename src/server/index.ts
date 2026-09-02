import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureForgeDirectories, publicConfig, repoRoot } from './config.js';
import { ApiErrorBody, DatabaseTableColumn, EnvironmentName, ProjectKind } from '../shared/types.js';
import { availableProviders } from './agent/modelProvider.js';
import { forgeOrchestrator } from './agent/orchestrator.js';
import { databaseService } from './services/databaseService.js';
import { deploymentService } from './services/deploymentService.js';
import { gitService } from './services/gitService.js';
import { integrationService } from './services/integrations.js';
import { projectService } from './services/projectService.js';
import { qaService } from './services/qaService.js';
import { supabaseService } from './services/supabaseService.js';
import { findFreePort, getProcess, listProcesses, startProjectProcess, stopProcess } from './services/processManager.js';
import { runCommand } from './services/commandRunner.js';
import { browserAutomationService } from './services/browserAutomation.js';

ensureForgeDirectories();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

function asyncRoute<T extends express.Request>(handler: (req: T, res: express.Response) => Promise<unknown> | unknown) {
  return (req: T, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

function send<T>(res: express.Response, body: T) {
  res.json(body);
}

app.get('/api/health', (_req, res) => send(res, { ok: true, name: 'Forge AI', checkedAt: new Date().toISOString() }));
app.get('/api/config', (_req, res) => send(res, { ...publicConfig(), providers: availableProviders() }));

app.get('/api/projects', (_req, res) => send(res, projectService.listProjects()));
app.post(
  '/api/projects',
  asyncRoute(async (req, res) => {
    const { name, description, kind, instruction } = req.body as { name?: string; description?: string; kind?: string; instruction?: string };
    if (!name?.trim()) throw new Error('Project name is required.');
    const project = projectService.createProject({ name: name.trim(), description, kind: kind as never });
    if (instruction?.trim()) {
      const task = await forgeOrchestrator.run(project.id, instruction.trim());
      send(res, { project: projectService.getProject(project.id), task });
      return;
    }
    send(res, { project });
  })
);
app.get('/api/projects/:projectId', (req, res) => send(res, projectService.getProject(req.params.projectId)));
app.get('/api/projects/:projectId/requirements', (req, res) => send(res, projectService.listRequirements(req.params.projectId)));
app.get('/api/projects/:projectId/memory', (req, res) => send(res, projectService.listMemory(req.params.projectId)));
app.get('/api/projects/:projectId/decisions', (req, res) => send(res, projectService.listDecisions(req.params.projectId)));
app.get('/api/projects/:projectId/checkpoints', (req, res) => send(res, projectService.listCheckpoints(req.params.projectId)));
app.post('/api/projects/:projectId/checkpoints/:checkpointId/restore', (req, res) => send(res, projectService.restoreCheckpoint(req.params.projectId, req.params.checkpointId)));

app.get('/api/projects/:projectId/files', (req, res) => send(res, projectService.listFiles(req.params.projectId, String(req.query.path || '.'))));
app.get('/api/projects/:projectId/file', (req, res) => send(res, projectService.readFile(req.params.projectId, String(req.query.path || ''))));
app.put('/api/projects/:projectId/file', (req, res) => {
  const { path: relativePath, content } = req.body as { path?: string; content?: string };
  if (!relativePath) throw new Error('File path is required.');
  send(res, projectService.writeFile(req.params.projectId, relativePath, content ?? ''));
});
app.delete('/api/projects/:projectId/file', (req, res) => send(res, projectService.deletePath(req.params.projectId, String(req.query.path || ''))));
app.post('/api/projects/:projectId/index', (req, res) => send(res, projectService.indexProject(req.params.projectId)));
app.post('/api/projects/:projectId/search', (req, res) => send(res, projectService.searchProject(req.params.projectId, String((req.body as { query?: string }).query || ''))));

app.get('/api/projects/:projectId/tasks', (req, res) => send(res, forgeOrchestrator.listTasks(req.params.projectId)));
app.post(
  '/api/projects/:projectId/agent',
  asyncRoute(async (req, res) => {
    const instruction = String((req.body as { instruction?: string }).instruction || '').trim();
    if (!instruction) throw new Error('Instruction is required.');
    const task = await forgeOrchestrator.run(req.params.projectId, instruction);
    send(res, task);
  })
);
app.post(
  '/api/projects/:projectId/starter',
  asyncRoute(async (req, res) => {
    const body = req.body as { instruction?: string; kind?: ProjectKind };
    const instruction = String(body.instruction || 'Create a verified working starter project.').trim();
    const task = await forgeOrchestrator.buildVerifiedStarter(req.params.projectId, instruction, body.kind);
    send(res, task);
  })
);
app.get('/api/tasks/:taskId', (req, res) => send(res, forgeOrchestrator.getTask(req.params.taskId)));

app.post(
  '/api/projects/:projectId/terminal',
  asyncRoute(async (req, res) => {
    const project = projectService.getProject(req.params.projectId);
    const command = String((req.body as { command?: string }).command || '').trim();
    const result = await runCommand({ cwd: project.rootPath, command, timeoutMs: 180_000, allowFailure: true });
    send(res, result);
  })
);

app.get('/api/projects/:projectId/processes', (req, res) => send(res, listProcesses(req.params.projectId)));
app.get('/api/processes/:processId', (req, res) => send(res, getProcess(req.params.processId)));
app.post(
  '/api/projects/:projectId/preview/start',
  asyncRoute(async (req, res) => {
    const project = projectService.getProject(req.params.projectId);
    const pkgPath = path.join(project.rootPath, 'package.json');
    if (!fs.existsSync(pkgPath)) throw new Error('Cannot start preview: package.json does not exist. Ask the agent to build the project first.');
    if (!fs.existsSync(path.join(project.rootPath, 'node_modules'))) {
      await runCommand({ cwd: project.rootPath, command: 'npm install --silent', timeoutMs: 180_000, allowFailure: true });
    }
    const port = await findFreePort(4300);
    const processRecord = await startProjectProcess({ projectId: project.id, cwd: project.rootPath, name: `${project.name} preview`, command: 'npm run dev', port });
    projectService.updateProject(project.id, { preview: { processId: processRecord.id, port, command: processRecord.command, startedAt: processRecord.startedAt } });
    send(res, processRecord);
  })
);
app.post('/api/processes/:processId/stop', (req, res) => send(res, stopProcess(req.params.processId)));

app.post(
  '/api/projects/:projectId/qa',
  asyncRoute(async (req, res) => {
    const report = await qaService.runQualityGate(req.params.projectId, { install: Boolean((req.body as { install?: boolean }).install) });
    send(res, report);
  })
);
app.post(
  '/api/projects/:projectId/browser-test',
  asyncRoute(async (req, res) => {
    const project = projectService.getProject(req.params.projectId);
    const requestedUrl = String((req.body as { url?: string }).url || '');
    const url = requestedUrl || (project.preview?.port ? `http://localhost:${project.preview.port}` : '');
    if (!url) throw new Error('No URL supplied and no active preview exists for this project.');
    send(res, await browserAutomationService.inspect(url));
  })
);

app.get('/api/integrations', (_req, res) => send(res, integrationService.registry()));
app.get('/api/integrations/connections', (_req, res) => send(res, integrationService.listConnections()));
app.get('/api/integrations/secrets', (req, res) => send(res, integrationService.listSecretReferences(String(req.query.integrationId || '') || undefined)));
app.post('/api/integrations/connections', (req, res) => {
  const { integrationId, name, environments, credentials, environment } = req.body as {
    integrationId?: string;
    name?: string;
    environments?: EnvironmentName[];
    credentials?: Record<string, string>;
    environment?: EnvironmentName;
  };
  if (!integrationId) throw new Error('integrationId is required.');
  send(res, integrationService.upsertConnection({ integrationId, name, environments, credentials, environment }));
});

app.get('/api/projects/:projectId/database/tables', (req, res) => send(res, databaseService.listTables(req.params.projectId)));
app.get('/api/projects/:projectId/database/migrations', (req, res) => send(res, databaseService.inspectMigrations(req.params.projectId)));
app.post('/api/projects/:projectId/database/tables', (req, res) => {
  const body = req.body as { name?: string; description?: string; columns?: DatabaseTableColumn[]; rlsEnabled?: boolean; policies?: string[]; indexes?: string[] };
  if (!body.name) throw new Error('Table name is required.');
  if (!body.columns?.length) throw new Error('At least one column is required.');
  send(res, databaseService.upsertTable({ projectId: req.params.projectId, name: body.name, description: body.description, columns: body.columns, rlsEnabled: body.rlsEnabled, policies: body.policies, indexes: body.indexes }));
});
app.post(
  '/api/projects/:projectId/supabase/apply-migrations',
  asyncRoute(async (req, res) => send(res, await supabaseService.applyMigrations(req.params.projectId, ((req.body as { environment?: EnvironmentName }).environment || 'development') as EnvironmentName)))
);
app.get(
  '/api/supabase/schema',
  asyncRoute(async (req, res) => send(res, await supabaseService.inspectSchema((String(req.query.environment || 'development')) as EnvironmentName)))
);
app.post(
  '/api/supabase/storage/buckets',
  asyncRoute(async (req, res) => send(res, await supabaseService.createStorageBucket(String((req.body as { name?: string }).name || 'uploads'), ((req.body as { environment?: EnvironmentName }).environment || 'development') as EnvironmentName)))
);

app.get(
  '/api/projects/:projectId/git/status',
  asyncRoute(async (req, res) => send(res, await gitService.status(req.params.projectId)))
);
app.get(
  '/api/projects/:projectId/git/diff',
  asyncRoute(async (req, res) => send(res, await gitService.diff(req.params.projectId)))
);
app.post(
  '/api/projects/:projectId/git/commit',
  asyncRoute(async (req, res) => send(res, await gitService.commit(req.params.projectId, String((req.body as { message?: string }).message || 'Forge AI checkpoint'))))
);
app.post(
  '/api/projects/:projectId/git/branch',
  asyncRoute(async (req, res) => send(res, await gitService.createBranch(req.params.projectId, String((req.body as { branch?: string }).branch || 'forge/change'))))
);
app.post(
  '/api/projects/:projectId/git/switch',
  asyncRoute(async (req, res) => send(res, await gitService.switchBranch(req.params.projectId, String((req.body as { branch?: string }).branch || 'main'))))
);
app.post('/api/projects/:projectId/git/push', asyncRoute(async (req, res) => send(res, await gitService.push(req.params.projectId))));
app.post('/api/projects/:projectId/git/pull', asyncRoute(async (req, res) => send(res, await gitService.pull(req.params.projectId))));
app.post(
  '/api/projects/:projectId/github/create-repo',
  asyncRoute(async (req, res) => send(res, await gitService.createGithubRepository(req.params.projectId, String((req.body as { name?: string }).name || ''), Boolean((req.body as { private?: boolean }).private ?? true))))
);
app.post(
  '/api/projects/:projectId/github/import',
  asyncRoute(async (req, res) => send(res, await gitService.cloneIntoProject(req.params.projectId, String((req.body as { repositoryUrl?: string }).repositoryUrl || ''))))
);
app.get('/api/github/repos', asyncRoute(async (_req, res) => send(res, await gitService.githubRepos())));
app.post(
  '/api/projects/:projectId/github/pr',
  asyncRoute(async (req, res) => send(res, await gitService.createPullRequest(req.params.projectId, String((req.body as { title?: string }).title || 'Forge AI changes'), String((req.body as { body?: string }).body || 'Created by Forge AI.'))))
);

app.get('/api/projects/:projectId/deployments', (req, res) => send(res, deploymentService.list(req.params.projectId)));
app.post(
  '/api/projects/:projectId/deploy/vercel',
  asyncRoute(async (req, res) => send(res, await deploymentService.deployVercel(req.params.projectId, ((req.body as { environment?: EnvironmentName }).environment || 'preview') as EnvironmentName)))
);
app.post(
  '/api/projects/:projectId/publish/arena',
  asyncRoute(async (req, res) => send(res, await deploymentService.publishArenaPreview(req.params.projectId)))
);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown Forge API route: ${req.method} ${req.originalUrl}` });
});

app.use((err: unknown, _req: express.Request, res: express.Response<ApiErrorBody>, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  res.status(400).json({ error: message });
});

async function attachFrontend() {
  if (process.env.NODE_ENV === 'production') {
    const clientRoot = path.resolve(repoRoot, 'dist/client');
    app.use(express.static(clientRoot));
    app.get('*', (_req, res) => res.sendFile(path.join(clientRoot, 'index.html')));
    return;
  }

  const { createServer } = await import('vite');
  const vite = await createServer({
    root: repoRoot,
    server: { middlewareMode: true, ws: { port: 24678 }, allowedHosts: true, watch: { ignored: ['**/workspace/**', '**/.forge/**', '**/dist/**'] } },
    appType: 'custom'
  });
  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    try {
      const template = fs.readFileSync(path.resolve(repoRoot, 'index.html'), 'utf8');
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

await attachFrontend();

const port = Number(process.env.FORGE_PORT || process.env.PORT || 5173);
app.listen(port, '0.0.0.0', () => {
  console.log(`Forge AI listening on http://0.0.0.0:${port}`);
});
