import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { forgeApi, previewUrl } from './api';
import type { ForgeConfig } from './api';
import type {
  AgentTask,
  CommandResult,
  DatabaseTable,
  DeploymentRecord,
  FileEntry,
  FileNode,
  IntegrationConnection,
  IntegrationDefinition,
  ProcessLog,
  ProjectKind,
  ProjectRecord,
  QualityGateReport,
  RequirementRecord
} from '../shared/types';
import './styles.css';

type Tab = 'files' | 'preview' | 'qa' | 'integrations' | 'git' | 'database';

const fullStackPrompt = 'Build a real full-stack application with email/password authentication, protected data, backend APIs, database persistence, tests, secure secrets, and deployable preview.';
const gamePrompt = 'Build a playable 2D pixel-art roguelite game with movement, collision, enemies, combat, loot, progression, saving, real assets, tests, and live preview.';

function publicForgeUrl() {
  return window.location.href.replace(/\/$/, '');
}

function App() {
  const [config, setConfig] = useState<ForgeConfig | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [requirements, setRequirements] = useState<RequirementRecord[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [openFile, setOpenFile] = useState<FileEntry | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [instruction, setInstruction] = useState(fullStackPrompt);
  const [task, setTask] = useState<AgentTask | null>(null);
  const [qa, setQa] = useState<QualityGateReport | null>(null);
  const [terminalCommand, setTerminalCommand] = useState('npm run build');
  const [terminal, setTerminal] = useState<CommandResult[]>([]);
  const [preview, setPreview] = useState<ProcessLog | null>(null);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [browserOutput, setBrowserOutput] = useState('');
  const [integrations, setIntegrations] = useState<IntegrationDefinition[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState('supabase');
  const [credentials, setCredentials] = useState('{\n  "SUPABASE_URL": "",\n  "SUPABASE_ANON_KEY": "",\n  "SUPABASE_SERVICE_ROLE_KEY": "",\n  "SUPABASE_DB_URL": ""\n}');
  const [git, setGit] = useState<{ status: CommandResult; branch: string; log: string } | null>(null);
  const [diff, setDiff] = useState<CommandResult | null>(null);
  const [tables, setTables] = useState<DatabaseTable[]>([]);
  const [supabaseOutput, setSupabaseOutput] = useState('');
  const [tab, setTab] = useState<Tab>('preview');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const activeProject = projects.find((project) => project.id === activeProjectId) || projects[0];
  const realProviders = config?.providers.filter((provider) => provider.configured) || [];
  const aiAvailable = realProviders.length > 0;

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!activeProjectId && projects[0]) setActiveProjectId(projects[0].id);
  }, [projects, activeProjectId]);

  useEffect(() => {
    if (activeProject) void loadProject(activeProject.id);
  }, [activeProject?.id]);

  async function act<T>(label: string, fn: () => Promise<T>, done?: (value: T) => void | Promise<void>) {
    setBusy(label);
    setMessage('');
    try {
      const result = await fn();
      await done?.(result);
      setMessage(`${label} finished.`);
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function bootstrap() {
    const [cfg, projectList, registry, connectionList] = await Promise.all([
      forgeApi.config(),
      forgeApi.listProjects(),
      forgeApi.integrations(),
      forgeApi.connections()
    ]);
    setConfig(cfg);
    setProjects(projectList);
    setIntegrations(registry);
    setConnections(connectionList);
  }

  async function loadProject(projectId: string) {
    const [projectList, reqs, tree, tasks, deps, tableList] = await Promise.all([
      forgeApi.listProjects(),
      forgeApi.requirements(projectId),
      forgeApi.files(projectId),
      forgeApi.tasks(projectId),
      forgeApi.deployments(projectId),
      forgeApi.databaseTables(projectId)
    ]);
    setProjects(projectList);
    setRequirements(reqs);
    setFiles(tree);
    setTask(tasks[0] || null);
    setDeployments(deps);
    setTables(tableList);
  }

  async function createProject(kind: ProjectKind, starter?: 'fullstack' | 'game') {
    const defaultName = starter === 'game' ? 'Forge Pixel Quest' : starter === 'fullstack' ? 'Forge Auth App' : 'Forge Project';
    const name = window.prompt('Project name', defaultName);
    if (!name) return;
    await act('Create project', () => forgeApi.createProject({ name, kind, description: 'Forge workspace' }), async ({ project }) => {
      await bootstrap();
      setActiveProjectId(project.id);
      if (starter) {
        const starterPrompt = starter === 'game' ? gamePrompt : fullStackPrompt;
        const built = await forgeApi.buildStarter(project.id, starterPrompt, starter === 'game' ? 'game' : 'saas');
        setTask(built);
        setQa(built.qa || null);
        await loadProject(project.id);
        setTab('preview');
      }
    });
  }

  async function runRealAi() {
    if (!activeProject) return;
    await act('Real AI agent', () => forgeApi.runAgent(activeProject.id, instruction), async (nextTask) => {
      setTask(nextTask);
      setQa(nextTask.qa || null);
      await loadProject(activeProject.id);
    });
  }

  async function buildStarter(kind: 'fullstack' | 'game') {
    if (!activeProject) return;
    const prompt = kind === 'game' ? gamePrompt : fullStackPrompt;
    await act('Verified starter build', () => forgeApi.buildStarter(activeProject.id, prompt, kind === 'game' ? 'game' : 'saas'), async (nextTask) => {
      setTask(nextTask);
      setQa(nextTask.qa || null);
      await loadProject(activeProject.id);
      setTab('preview');
    });
  }

  async function startPreview() {
    if (!activeProject) return;
    await act('Live preview', () => forgeApi.startPreview(activeProject.id), (process) => {
      setPreview(process);
      setTab('preview');
    });
  }

  async function publishArena() {
    if (!activeProject) return;
    await act('Arena publish', () => forgeApi.publishArena(activeProject.id), async (deployment) => {
      setDeployments([deployment, ...(await forgeApi.deployments(activeProject.id))]);
      setTab('preview');
    });
  }

  async function runBrowserTest() {
    if (!activeProject) return;
    await act('Browser test', () => forgeApi.browserTest(activeProject.id), (report) => {
      setBrowserOutput(`${report.status}: ${report.errors.join('\n') || report.networkFailures.join('\n') || report.console.join('\n') || report.title || 'no browser issues reported'}`);
      setTab('preview');
    });
  }

  async function runQa() {
    if (!activeProject) return;
    await act('QA', () => forgeApi.qa(activeProject.id, true), (report) => {
      setQa(report);
      setTab('qa');
    });
  }

  async function runTerminal() {
    if (!activeProject) return;
    await act('Terminal command', () => forgeApi.terminal(activeProject.id, terminalCommand), (result) => {
      setTerminal((items) => [result, ...items].slice(0, 10));
      setTab('qa');
    });
  }

  async function openProjectFile(path: string) {
    if (!activeProject) return;
    await act('Open file', () => forgeApi.readFile(activeProject.id, path), (file) => {
      setOpenFile(file);
      setEditorContent(file.content);
      setTab('files');
    });
  }

  async function saveFile() {
    if (!activeProject || !openFile) return;
    await act('Save file', () => forgeApi.writeFile(activeProject.id, openFile.path, editorContent), async (file) => {
      setOpenFile(file);
      await loadProject(activeProject.id);
    });
  }

  async function connectIntegration() {
    await act('Connect integration', async () => forgeApi.connectIntegration({ integrationId: selectedIntegration, environment: 'development', credentials: JSON.parse(credentials) }), async () => {
      setConnections(await forgeApi.connections());
    });
  }

  async function gitPush() {
    if (!activeProject) return;
    await act('Git push', () => forgeApi.push(activeProject.id), (result) => setTerminal((items) => [result, ...items].slice(0, 10)));
  }

  async function gitPull() {
    if (!activeProject) return;
    await act('Git pull', () => forgeApi.pull(activeProject.id), (result) => setTerminal((items) => [result, ...items].slice(0, 10)));
  }

  async function createGithubRepo() {
    if (!activeProject) return;
    const name = window.prompt('GitHub repo name', activeProject.slug);
    if (!name) return;
    await act('Create GitHub repo', () => forgeApi.createGithubRepository(activeProject.id, name, true), (result) => setTerminal((items) => [result, ...items].slice(0, 10)));
  }

  async function refreshGit() {
    if (!activeProject) return;
    await act('Git refresh', async () => ({ status: await forgeApi.gitStatus(activeProject.id), diff: await forgeApi.gitDiff(activeProject.id) }), ({ status, diff }) => {
      setGit(status);
      setDiff(diff);
      setTab('git');
    });
  }

  async function applySupabaseMigrations() {
    if (!activeProject) return;
    await act('Apply Supabase migrations', () => forgeApi.applySupabaseMigrations(activeProject.id), (result) => {
      setSupabaseOutput(`${result.status}: ${result.output}`);
    });
  }

  async function inspectSupabaseSchema() {
    await act('Inspect Supabase schema', () => forgeApi.inspectSupabaseSchema(), (result) => {
      setSupabaseOutput(`${result.status}: ${result.output}`);
    });
  }

  async function createTable() {
    if (!activeProject) return;
    await act('Create migration', () => forgeApi.createTable(activeProject.id, {
      name: 'features',
      description: 'Authenticated user-owned app data.',
      rlsEnabled: true,
      indexes: ['owner_id'],
      columns: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true, defaultValue: 'gen_random_uuid()' },
        { name: 'owner_id', type: 'uuid', nullable: false },
        { name: 'title', type: 'text', nullable: false },
        { name: 'status', type: 'text', nullable: false, defaultValue: "'planned'" },
        { name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }
      ]
    }), async () => loadProject(activeProject.id));
  }

  const previewLink = useMemo(() => {
    const deployed = deployments.find((deployment) => deployment.provider === 'arena' && deployment.url)?.url;
    if (deployed) return deployed;
    const port = preview?.port || activeProject?.preview?.port;
    return port ? previewUrl(port) : '';
  }, [deployments, preview?.port, activeProject?.preview?.port]);

  return (
    <main className="page">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="pill">FORGE AI</span>
          <h1>Real app + game builder control surface</h1>
          <p>Forge now blocks fake AI. If a real model endpoint is unavailable, it says so. Verified starters still create real runnable full-stack apps and playable games so preview/publish can be tested immediately.</p>
          <div className="url-box">
            <span>Game maker URL</span>
            <a href={publicForgeUrl()} target="_blank" rel="noreferrer">{publicForgeUrl()}</a>
          </div>
        </div>
        <div className="engine-card">
          <strong>{aiAvailable ? 'Real AI connected' : 'No fake AI running'}</strong>
          <small>{aiAvailable ? realProviders.map((p) => p.label || p.id).join(', ') : 'Arena chat AI is not exposed to this app as a callable model endpoint. Configure an actual provider or use verified starters.'}</small>
          <div className="engine-list">
            {config?.providers.map((provider) => <span key={provider.id} className={provider.configured ? 'ok' : 'off'}>{provider.label || provider.id}: {provider.configured ? 'ready' : 'not connected'}</span>)}
          </div>
        </div>
      </section>

      <section className="builder-card">
        <div>
          <h2>Tell Forge what to build</h2>
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} />
          <div className="actions">
            <button className="primary" disabled={!activeProject || Boolean(busy)} onClick={runRealAi}>Build with real AI</button>
            <button disabled={!activeProject || Boolean(busy)} onClick={() => buildStarter('fullstack')}>Build verified full-stack auth app</button>
            <button disabled={!activeProject || Boolean(busy)} onClick={() => buildStarter('game')}>Build verified playable game</button>
          </div>
          {!aiAvailable && <p className="truth">The AI button will block instead of pretending. The verified starter buttons are real code generators, not AI.</p>}
        </div>
        <div className="quick-create">
          <h3>Start fast</h3>
          <button onClick={() => createProject('saas', 'fullstack')}>+ New full-stack auth app</button>
          <button onClick={() => createProject('game', 'game')}>+ New playable game</button>
          <button onClick={() => createProject('web')}>+ Empty project</button>
        </div>
      </section>

      {message && <div className="message">{message}</div>}
      {busy && <div className="busy">{busy} is running real filesystem/terminal operations…</div>}

      <section className="main-grid">
        <aside className="projects">
          <h2>Projects</h2>
          {projects.map((project) => (
            <button key={project.id} className={project.id === activeProject?.id ? 'selected' : ''} onClick={() => setActiveProjectId(project.id)}>
              <strong>{project.name}</strong>
              <span>{project.kind} · {project.status}</span>
            </button>
          ))}
          {!projects.length && <p>No projects yet. Create a verified starter above.</p>}
        </aside>

        <section className="workbench">
          <div className="tabs">
            {(['preview', 'files', 'qa', 'integrations', 'git', 'database'] as Tab[]).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}
          </div>
          {tab === 'preview' && <PreviewTab activeProject={activeProject} previewLink={previewLink} deployments={deployments} browserOutput={browserOutput} task={task} startPreview={startPreview} publishArena={publishArena} runQa={runQa} runBrowserTest={runBrowserTest} />}
          {tab === 'files' && <FilesTab files={files} openFile={openFile} content={editorContent} setContent={setEditorContent} open={openProjectFile} save={saveFile} />}
          {tab === 'qa' && <QaTab qa={qa || task?.qa || null} terminalCommand={terminalCommand} setTerminalCommand={setTerminalCommand} runTerminal={runTerminal} terminal={terminal} />}
          {tab === 'integrations' && <IntegrationsTab integrations={integrations} connections={connections} selected={selectedIntegration} setSelected={setSelectedIntegration} credentials={credentials} setCredentials={setCredentials} connect={connectIntegration} />}
          {tab === 'git' && <GitTab git={git} diff={diff} refresh={refreshGit} push={gitPush} pull={gitPull} createRepo={createGithubRepo} activeProject={activeProject} />}
          {tab === 'database' && <DatabaseTab tables={tables} createTable={createTable} applySupabase={applySupabaseMigrations} inspectSupabase={inspectSupabaseSchema} supabaseOutput={supabaseOutput} />}
        </section>

        <aside className="task-panel">
          <h2>Truth panel</h2>
          <StatusLine label="Active project" value={activeProject?.name || 'none'} />
          <StatusLine label="Real AI" value={aiAvailable ? 'connected' : 'not connected'} />
          <StatusLine label="Requirements" value={String(requirements.length)} />
          <StatusLine label="Last task" value={task?.status || 'none'} />
          {task && <div className="timeline">{task.steps.map((step) => <div key={step.id} className={step.status}><strong>{step.title}</strong><span>{step.status}</span><p>{step.details}</p></div>)}</div>}
          <h3>Requirements</h3>
          <div className="requirements">{requirements.slice(0, 10).map((req) => <p key={req.id}><strong>{req.owner}</strong>{req.text}</p>)}</div>
        </aside>
      </section>
    </main>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return <div className="status-line"><span>{label}</span><strong>{value}</strong></div>;
}

function PreviewTab(props: { activeProject?: ProjectRecord; previewLink: string; deployments: DeploymentRecord[]; browserOutput: string; task: AgentTask | null; startPreview: () => void; publishArena: () => void; runQa: () => void; runBrowserTest: () => void }) {
  return (
    <div className="preview-tab">
      <div className="preview-actions">
        <button onClick={props.runQa} disabled={!props.activeProject}>Run QA</button>
        <button onClick={props.startPreview} disabled={!props.activeProject}>Start live preview</button>
        <button onClick={props.runBrowserTest} disabled={!props.activeProject || !props.previewLink}>Browser test</button>
        <button className="primary" onClick={props.publishArena} disabled={!props.activeProject}>Publish Arena URL</button>
      </div>
      {props.previewLink ? <><a className="open-link" href={props.previewLink} target="_blank" rel="noreferrer">Open actual generated app: {props.previewLink}</a><iframe title="Actual project preview" src={props.previewLink} /></> : <div className="empty">No preview yet. Build a starter or real AI project, then start preview/publish.</div>}
      {props.browserOutput && <pre>{props.browserOutput}</pre>}
      <div className="deploy-list">{props.deployments.map((deployment) => <div key={deployment.id}><strong>{deployment.provider}</strong><span>{deployment.status}</span><small>{deployment.url || deployment.logs.join(' ').slice(0, 180)}</small></div>)}</div>
    </div>
  );
}

function FilesTab({ files, openFile, content, setContent, open, save }: { files: FileNode[]; openFile: FileEntry | null; content: string; setContent: (value: string) => void; open: (path: string) => void; save: () => void }) {
  return <div className="files-tab"><aside><Tree nodes={files} open={open} /></aside><section><div><strong>{openFile?.path || 'Open a file'}</strong><button disabled={!openFile} onClick={save}>Save real file</button></div><textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} /></section></div>;
}

function Tree({ nodes, open, depth = 0 }: { nodes: FileNode[]; open: (path: string) => void; depth?: number }) {
  return <>{nodes.map((node) => <div key={node.path} style={{ paddingLeft: depth * 10 }}>{node.type === 'directory' ? <><p className="dir">▾ {node.name}</p><Tree nodes={node.children || []} open={open} depth={depth + 1} /></> : <button className="file" onClick={() => open(node.path)}>◇ {node.name}</button>}</div>)}</>;
}

function QaTab({ qa, terminalCommand, setTerminalCommand, runTerminal, terminal }: { qa: QualityGateReport | null; terminalCommand: string; setTerminalCommand: (value: string) => void; runTerminal: () => void; terminal: CommandResult[] }) {
  return <div className="qa-tab"><div className="terminal-input"><span>$</span><input value={terminalCommand} onChange={(event) => setTerminalCommand(event.target.value)} /><button onClick={runTerminal}>Run</button></div>{qa ? <div className="checks"><h3>{qa.summary}</h3>{qa.checks.map((check) => <pre key={check.name}>{check.name} · {check.status}\n{check.output}</pre>)}</div> : <p className="empty">No QA report yet.</p>}{terminal.map((result) => <pre key={result.id}>$ {result.command} · exit {result.exitCode}\n{result.stdout}{result.stderr}</pre>)}</div>;
}

function IntegrationsTab(props: { integrations: IntegrationDefinition[]; connections: IntegrationConnection[]; selected: string; setSelected: (value: string) => void; credentials: string; setCredentials: (value: string) => void; connect: () => void }) {
  const active = props.integrations.find((integration) => integration.id === props.selected);
  return <div className="integrations-tab"><aside>{props.integrations.map((integration) => <button key={integration.id} className={integration.id === props.selected ? 'selected' : ''} onClick={() => props.setSelected(integration.id)}>{integration.name}<span>{integration.category}</span></button>)}</aside><section><h2>{active?.name}</h2><p>{active?.description}</p><p className="truth">Only connected credentials enable real external operations. Missing credentials block instead of faking success.</p><textarea value={props.credentials} onChange={(event) => props.setCredentials(event.target.value)} /><button onClick={props.connect}>Encrypt/connect credentials</button><h3>Connections</h3>{props.connections.map((connection) => <p key={connection.id}>{connection.name}: {connection.status} ({connection.credentialKeys.join(', ') || 'no credentials'})</p>)}</section></div>;
}

function GitTab({ git, diff, refresh, push, pull, createRepo, activeProject }: { git: { status: CommandResult; branch: string; log: string } | null; diff: CommandResult | null; refresh: () => void; push: () => void; pull: () => void; createRepo: () => void; activeProject?: ProjectRecord }) {
  return <div className="git-tab"><div className="preview-actions"><button disabled={!activeProject} onClick={refresh}>Refresh real Git status</button><button disabled={!activeProject} onClick={pull}>Pull</button><button disabled={!activeProject} onClick={push}>Push</button><button disabled={!activeProject} onClick={createRepo}>Create GitHub repo + push</button></div><pre>{git ? `Branch: ${git.branch}\n${git.status.stdout || git.status.stderr}\n\n${git.log}` : 'Git status not loaded.'}</pre><pre>{diff?.stdout || diff?.stderr || 'Diff not loaded.'}</pre></div>;
}

function DatabaseTab({ tables, createTable, applySupabase, inspectSupabase, supabaseOutput }: { tables: DatabaseTable[]; createTable: () => void; applySupabase: () => void; inspectSupabase: () => void; supabaseOutput: string }) {
  return <div className="database-tab"><button onClick={createTable}>Create real SQL migration</button><button onClick={applySupabase}>Apply to real Supabase</button><button onClick={inspectSupabase}>Inspect real Supabase schema</button>{supabaseOutput && <pre>{supabaseOutput}</pre>}{tables.map((table) => <div key={table.id} className="table-card"><strong>{table.name}</strong><span>{table.description}</span><small>{table.columns.map((col) => `${col.name}:${col.type}`).join(', ')}</small></div>)}</div>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
