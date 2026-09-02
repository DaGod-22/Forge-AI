import fs from 'node:fs';
import path from 'node:path';
import { AgentRole, AgentTask, ProjectKind, QualityGateReport, RequirementRecord, TaskStep, TaskStatus } from '../../shared/types.js';
import { createId, nowIso, safeJoin } from '../security.js';
import { store } from '../store.js';
import { databaseService } from '../services/databaseService.js';
import { projectService } from '../services/projectService.js';
import { qaService } from '../services/qaService.js';
import { gitService } from '../services/gitService.js';
import { createScaffold, ScaffoldPlan } from './templates.js';
import { availableProviders, NoConfiguredModelError, selectProvider } from './modelProvider.js';

const TASKS_TABLE = 'agent-tasks';

interface ModelImplementationFile {
  path: string;
  content: string;
}

interface ModelImplementationCommand {
  command: string;
  reason?: string;
}

interface ModelImplementationPlan {
  summary: string;
  projectKind?: ProjectKind;
  techStack?: string[];
  decisions?: { title: string; rationale: string; consequences?: string[] }[];
  files: ModelImplementationFile[];
  commands?: ModelImplementationCommand[];
}

function createStep(title: string, agent: AgentRole, details = ''): TaskStep {
  return { id: createId('step'), title, agent, status: 'queued', details };
}

function setStep(step: TaskStep, status: TaskStatus, details?: string) {
  if (status === 'running') step.startedAt = nowIso();
  if (status === 'passed' || status === 'failed' || status === 'blocked') step.finishedAt = nowIso();
  step.status = status;
  if (details) step.details = details;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export class ForgeOrchestrator {
  listTasks(projectId?: string) {
    return store
      .read<AgentTask[]>(TASKS_TABLE, [])
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getTask(taskId: string) {
    const task = this.listTasks().find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task ${taskId}`);
    return task;
  }

  providers() {
    return availableProviders();
  }

  async run(projectId: string, instruction: string) {
    const project = projectService.getProject(projectId);
    const timestamp = nowIso();
    const kind = this.inferKind(project.kind, instruction);
    const agents = this.selectAgents(kind, instruction);
    const requirements = this.extractRequirements(projectId, instruction, agents);
    const task: AgentTask = {
      id: createId('task'),
      projectId,
      instruction,
      status: 'running',
      agents,
      plan: this.plan(kind, instruction, agents),
      steps: [
        createStep('Preflight real AI provider', 'architect'),
        createStep('Understand specification and update requirement tracker', 'architect'),
        createStep('Inspect/index real project files and checkpoint', 'architect'),
        createStep('Ask real model for architecture and code patch', kind === 'game' ? 'game-engineer' : 'frontend-engineer'),
        createStep('Apply model-generated file changes to filesystem', kind === 'game' ? 'game-engineer' : 'backend-engineer'),
        createStep('Configure real integration artifacts where requested', 'backend-engineer'),
        createStep('Run build, tests, audit, and self-debug loop', 'qa-engineer'),
        createStep('Create version-control checkpoint', 'qa-engineer')
      ],
      filesChanged: [],
      commands: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.saveTask(task);
    projectService.updateProject(projectId, { status: 'building', kind, lastTaskId: task.id });

    try {
      await this.executeRealAiTask(task, project.name, kind, instruction, requirements, agents);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task.status = error instanceof NoConfiguredModelError ? 'blocked' : 'failed';
      task.error = message;
      const running = task.steps.find((step) => step.status === 'running') || task.steps.find((step) => step.status === 'queued');
      if (running) setStep(running, task.status, message);
      this.saveTask(task);
      projectService.updateProject(projectId, { status: task.status === 'blocked' ? 'blocked' : 'needs-testing' });
    }
    return task;
  }

  /**
   * Real, explicitly non-AI starter builder. This exists so users can create a working full-stack or game project
   * immediately, but it is not labeled as an AI task and does not pretend to be model-generated.
   */
  async buildVerifiedStarter(projectId: string, instruction: string, forcedKind?: ProjectKind) {
    const project = projectService.getProject(projectId);
    const kind = forcedKind || this.inferKind(project.kind, instruction);
    const agents = this.selectAgents(kind, instruction);
    const requirements = this.extractRequirements(projectId, instruction, agents);
    const timestamp = nowIso();
    const task: AgentTask = {
      id: createId('starter'),
      projectId,
      instruction,
      status: 'running',
      agents,
      plan: ['Create verified non-AI starter files', 'Install dependencies', 'Run tests/build/audit', 'Commit checkpoint'],
      steps: [
        createStep('Create verified starter codebase', kind === 'game' ? 'game-engineer' : 'backend-engineer'),
        createStep('Run real QA gate', 'qa-engineer'),
        createStep('Commit starter checkpoint', 'qa-engineer')
      ],
      filesChanged: [],
      commands: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.saveTask(task);
    projectService.saveRequirements(requirements);
    projectService.updateProject(projectId, { status: 'building', kind, lastTaskId: task.id });

    const [writeStep, qaStep, gitStep] = task.steps;
    try {
      setStep(writeStep, 'running');
      const hasExistingFiles = fs.readdirSync(project.rootPath).filter((entry) => entry !== '.git').length > 0;
      if (hasExistingFiles) projectService.createCheckpoint(projectId, `Before verified starter ${task.id}`);
      const scaffold = createScaffold(kind, project.name, instruction, requirements, agents);
      const written = this.writeScaffoldFiles(project.rootPath, scaffold, true);
      task.filesChanged.push(...written);
      scaffold.decisions.forEach((decision) => projectService.addDecision(projectId, decision.title, decision.rationale, decision.consequences));
      this.configureIntegrationArtifacts(projectId, project.rootPath, instruction, requirements);
      projectService.updateProject(projectId, { techStack: scaffold.techStack, kind, status: 'needs-testing' });
      setStep(writeStep, 'passed', `${written.length} real files written. This was a verified starter, not fake AI.`);
      this.saveTask(task);

      setStep(qaStep, 'running');
      const report = await qaService.runQualityGate(projectId, { install: true });
      task.qa = report;
      setStep(qaStep, report.status, report.summary);
      this.saveTask(task);

      setStep(gitStep, 'running');
      const commit = await gitService.commit(projectId, `Forge verified starter: ${instruction.slice(0, 72)}`);
      task.commands.push(commit.add, commit.commit);
      const committed = commit.commit.exitCode === 0 || /nothing to commit/i.test(`${commit.commit.stdout}\n${commit.commit.stderr}`);
      setStep(gitStep, committed ? 'passed' : 'blocked', committed ? 'Git checkpoint created.' : 'Git checkpoint could not be committed.');
      task.status = report.status === 'passed' ? 'passed' : report.status;
      this.saveTask(task);
      projectService.updateProject(projectId, { status: task.status === 'passed' ? 'ready' : 'needs-testing' });
      projectService.indexProject(projectId);
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      const active = task.steps.find((step) => step.status === 'running') || task.steps.find((step) => step.status === 'queued');
      if (active) setStep(active, 'failed', task.error);
      this.saveTask(task);
      projectService.updateProject(projectId, { status: 'needs-testing' });
    }
    return task;
  }

  private async executeRealAiTask(task: AgentTask, projectName: string, kind: ProjectKind, instruction: string, requirements: RequirementRecord[], agents: AgentRole[]) {
    const project = projectService.getProject(task.projectId);
    const [preflightStep, requirementsStep, indexStep, architectureStep, filesStep, integrationsStep, qaStep, gitStep] = task.steps;

    setStep(preflightStep, 'running');
    const provider = selectProvider('coding');
    setStep(preflightStep, 'passed', `Using real provider: ${provider.label} (${provider.id}). No deterministic fallback is enabled.`);
    this.saveTask(task);

    setStep(requirementsStep, 'running');
    projectService.saveRequirements(requirements);
    projectService.addMemory(task.projectId, 'requirements', 'User instruction parsed', instruction, ['instruction', ...agents]);
    setStep(requirementsStep, 'passed', `${requirements.length} requirements tracked.`);
    this.saveTask(task);

    setStep(indexStep, 'running');
    const hasExistingFiles = fs.readdirSync(project.rootPath).filter((entry) => entry !== '.git').length > 0;
    if (hasExistingFiles) projectService.createCheckpoint(task.projectId, `Before task ${task.id}`);
    const index = projectService.indexProject(task.projectId);
    const searchContext = projectService.searchProject(task.projectId, instruction).slice(0, 8);
    setStep(indexStep, 'passed', `Indexed ${index.indexedFiles} files; checkpoint ${hasExistingFiles ? 'created' : 'not needed for empty project'}.`);
    this.saveTask(task);

    setStep(architectureStep, 'running');
    const implementation = await this.askModelForImplementation(provider, {
      projectName,
      kind,
      instruction,
      requirements,
      agents,
      searchContext
    });
    setStep(architectureStep, 'passed', implementation.summary || 'Model returned implementation patch.');
    this.saveTask(task);

    setStep(filesStep, 'running');
    const written = this.writeModelFiles(project.rootPath, implementation.files);
    task.filesChanged.push(...written);
    for (const decision of implementation.decisions || []) {
      projectService.addDecision(task.projectId, decision.title, decision.rationale, decision.consequences || []);
    }
    projectService.updateProject(task.projectId, {
      techStack: implementation.techStack?.length ? implementation.techStack : project.techStack,
      kind: implementation.projectKind || kind,
      status: 'needs-testing'
    });
    setStep(filesStep, 'passed', `${written.length} model-generated files written to disk.`);
    this.saveTask(task);

    setStep(integrationsStep, 'running');
    const integrationNotes = this.configureIntegrationArtifacts(task.projectId, project.rootPath, instruction, requirements);
    setStep(integrationsStep, 'passed', integrationNotes.join('\n'));
    this.saveTask(task);

    for (const command of implementation.commands || []) {
      const result = await import('../services/commandRunner.js').then(({ runCommand }) =>
        runCommand({ cwd: project.rootPath, command: command.command, timeoutMs: 180_000, allowFailure: true })
      );
      task.commands.push(result);
      this.saveTask(task);
      if (result.exitCode !== 0) break;
    }

    setStep(qaStep, 'running');
    let report = await qaService.runQualityGate(task.projectId, { install: true });
    for (let attempt = 1; attempt <= 2 && report.status !== 'passed'; attempt += 1) {
      const patch = await this.askModelForRepair(provider, instruction, report, project.rootPath, task.filesChanged.slice(-20));
      if (!patch.files.length) break;
      const repaired = this.writeModelFiles(project.rootPath, patch.files);
      task.filesChanged.push(...repaired);
      projectService.addMemory(task.projectId, 'bug', `AI repair attempt ${attempt}`, patch.summary, ['real-ai-repair', 'qa']);
      report = await qaService.runQualityGate(task.projectId, { install: false });
      this.saveTask(task);
    }
    task.qa = report;
    setStep(qaStep, report.status, report.summary);
    this.saveTask(task);

    setStep(gitStep, 'running');
    const commit = await gitService.commit(task.projectId, `Forge AI: ${instruction.slice(0, 80)}`);
    task.commands.push(commit.add, commit.commit);
    const committed = commit.commit.exitCode === 0 || /nothing to commit/i.test(`${commit.commit.stdout}\n${commit.commit.stderr}`);
    setStep(gitStep, committed ? 'passed' : 'blocked', committed ? 'Version-control checkpoint available.' : 'Git checkpoint could not be committed. Inspect Git tab for details.');

    task.status = report.status === 'passed' ? 'passed' : report.status;
    this.saveTask(task);
    projectService.updateProject(task.projectId, { status: task.status === 'passed' ? 'ready' : 'needs-testing' });
    projectService.indexProject(task.projectId);
  }

  private async askModelForImplementation(
    provider: { generate: (request: Parameters<ReturnType<typeof selectProvider>['generate']>[0]) => Promise<{ content: string }> },
    input: {
      projectName: string;
      kind: ProjectKind;
      instruction: string;
      requirements: RequirementRecord[];
      agents: AgentRole[];
      searchContext: { path: string; excerpt: string }[];
    }
  ): Promise<ModelImplementationPlan> {
    const response = await provider.generate({
      purpose: 'coding',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a real autonomous senior software engineer inside Forge AI. Return ONLY valid JSON. Do not use markdown. Generate actual project files, not descriptions. Include tests and package scripts. Never include secrets. If auth/database is requested, implement working local development behavior plus secure provider integration seams.'
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              task: input.instruction,
              projectName: input.projectName,
              inferredKind: input.kind,
              specialistAgents: input.agents,
              requirements: input.requirements.map((req) => ({ id: req.id, text: req.text, owner: req.owner })),
              relevantExistingFiles: input.searchContext,
              responseSchema: {
                summary: 'string',
                projectKind: 'web|saas|api|game|imported',
                techStack: ['string'],
                decisions: [{ title: 'string', rationale: 'string', consequences: ['string'] }],
                files: [{ path: 'relative/path.ext', content: 'complete file content' }],
                commands: [{ command: 'optional safe command such as npm install', reason: 'string' }]
              }
            },
            null,
            2
          )
        }
      ]
    });
    return this.parseImplementation(response.content);
  }

  private async askModelForRepair(
    provider: { generate: (request: Parameters<ReturnType<typeof selectProvider>['generate']>[0]) => Promise<{ content: string }> },
    instruction: string,
    report: QualityGateReport,
    projectRoot: string,
    changedFiles: string[]
  ): Promise<ModelImplementationPlan> {
    const fileSnippets = changedFiles
      .filter((file) => fs.existsSync(safeJoin(projectRoot, file)))
      .slice(-8)
      .map((file) => ({ path: file, content: fs.readFileSync(safeJoin(projectRoot, file), 'utf8').slice(0, 12000) }));
    const response = await provider.generate({
      purpose: 'coding',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You are debugging a real failed build/test. Return ONLY JSON matching {summary, files:[{path,content}], commands:[]}. Include complete corrected file contents. Do not claim success.'
        },
        {
          role: 'user',
          content: JSON.stringify({ originalInstruction: instruction, qaReport: report, relevantFiles: fileSnippets }, null, 2)
        }
      ]
    });
    return this.parseImplementation(response.content, true);
  }

  private parseImplementation(content: string, allowEmptyFiles = false): ModelImplementationPlan {
    const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    let parsed: ModelImplementationPlan;
    try {
      parsed = JSON.parse(stripped) as ModelImplementationPlan;
    } catch (error) {
      throw new Error(`Real AI provider did not return valid implementation JSON. Refusing to fake completion. ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed.summary !== 'string') throw new Error('AI implementation JSON is missing summary.');
    if (!Array.isArray(parsed.files)) throw new Error('AI implementation JSON is missing files array.');
    if (!allowEmptyFiles && parsed.files.length === 0) throw new Error('AI returned no file changes. Refusing to mark task complete.');
    for (const file of parsed.files) {
      if (!file.path || typeof file.content !== 'string') throw new Error('AI returned an invalid file patch entry.');
    }
    return parsed;
  }

  private writeModelFiles(projectRoot: string, files: ModelImplementationFile[]) {
    const written: string[] = [];
    for (const file of files) {
      if (file.path.startsWith('/') || file.path.includes('..')) throw new Error(`Unsafe AI file path rejected: ${file.path}`);
      const target = safeJoin(projectRoot, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, 'utf8');
      written.push(file.path);
    }
    return written;
  }

  private writeScaffoldFiles(projectRoot: string, scaffold: ScaffoldPlan, allowOverwrite: boolean) {
    const written: string[] = [];
    for (const file of scaffold.files) {
      const target = safeJoin(projectRoot, file.path);
      if (!allowOverwrite && fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, 'utf8');
      written.push(file.path);
    }
    return written;
  }

  private configureIntegrationArtifacts(projectId: string, projectRoot: string, instruction: string, requirements: RequirementRecord[]) {
    const notes = ['Integration registry checked. Secrets must be connected in Forge, not committed.'];
    const lower = instruction.toLowerCase();
    if (lower.includes('supabase') || lower.includes('database') || lower.includes('auth')) {
      const { migrationPath } = databaseService.upsertTable({
        projectId,
        name: 'profiles',
        description: 'Application user profiles linked to authenticated identities.',
        columns: [
          { name: 'id', type: 'uuid', nullable: false, primaryKey: true, defaultValue: 'gen_random_uuid()' },
          { name: 'owner_id', type: 'uuid', nullable: false },
          { name: 'email', type: 'text', nullable: true },
          { name: 'display_name', type: 'text', nullable: true },
          { name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }
        ],
        rlsEnabled: true,
        indexes: ['owner_id']
      });
      const { migrationPath: featureMigrationPath } = databaseService.upsertTable({
        projectId,
        name: 'features',
        description: 'Authenticated user-owned feature records used by the generated full-stack app.',
        columns: [
          { name: 'id', type: 'uuid', nullable: false, primaryKey: true, defaultValue: 'gen_random_uuid()' },
          { name: 'owner_id', type: 'uuid', nullable: false },
          { name: 'title', type: 'text', nullable: false },
          { name: 'status', type: 'text', nullable: false, defaultValue: "'planned'" },
          { name: 'created_at', type: 'timestamptz', nullable: false, defaultValue: 'now()' }
        ],
        rlsEnabled: true,
        indexes: ['owner_id']
      });
      notes.push(`Generated PostgreSQL/Supabase migrations: ${migrationPath}, ${featureMigrationPath}`);
    }
    if (lower.includes('github')) notes.push('GitHub operations use the real git/gh CLIs and fail honestly when not authenticated.');
    if (lower.includes('vercel') || lower.includes('deploy') || lower.includes('publish')) notes.push('Vercel deployments use the real Vercel CLI/API when VERCEL_TOKEN is connected; Arena publish starts a real shareable preview.');
    if (lower.includes('stripe') || lower.includes('payment')) notes.push('Stripe requires server-side STRIPE_SECRET_KEY; Forge will not expose it to browser code.');
    if (lower.includes('email') || lower.includes('resend')) notes.push('Email requires server-side provider credentials.');

    const operationsPath = safeJoin(projectRoot, 'docs/forge-task-report.md');
    fs.mkdirSync(path.dirname(operationsPath), { recursive: true });
    fs.writeFileSync(
      operationsPath,
      `# Forge Task Report\n\n## Requirements\n\n${requirements.map((req) => `- ${req.text}`).join('\n')}\n\n## Integration notes\n\n${notes.map((note) => `- ${note}`).join('\n')}\n`,
      'utf8'
    );
    return notes;
  }

  private inferKind(current: ProjectKind, instruction: string): ProjectKind {
    const lower = instruction.toLowerCase();
    if (/\b(game|rpg|roguelite|platformer|canvas|webgl|webgpu|phaser|pixi|three|sprite|combat|multiplayer)\b/.test(lower)) return 'game';
    if (/\b(api|backend|microservice|webhook|rest|graphql)\b/.test(lower)) return 'api';
    if (/\b(saas|subscription|stripe|dashboard|tenant|billing|auth)\b/.test(lower)) return 'saas';
    return current || 'web';
  }

  private selectAgents(kind: ProjectKind, instruction: string): AgentRole[] {
    const agents: AgentRole[] = ['architect'];
    if (kind === 'game') agents.push('game-engineer');
    if (kind !== 'api') agents.push('frontend-engineer');
    if (kind !== 'game' || /api|database|auth|stripe|backend|webhook|server|multiplayer|leaderboard/i.test(instruction)) agents.push('backend-engineer');
    if (/pixel|sprite|asset|audio|music|sound|art/i.test(instruction)) agents.push('asset-engineer');
    if (/auth|security|secret|stripe|supabase|rls|permission/i.test(instruction)) agents.push('security-engineer');
    if (/performance|optimi[sz]e|fps|bundle|scale/i.test(instruction)) agents.push('performance-engineer');
    agents.push('qa-engineer');
    return unique(agents);
  }

  private extractRequirements(projectId: string, instruction: string, agents: AgentRole[]): RequirementRecord[] {
    const existing = projectService.listRequirements(projectId);
    const fragments = instruction
      .split(/\n|\r|(?:^|\s)(?:- |\* |\d+\. )/)
      .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z"'])/))
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .filter((line) => line.length > 10)
      .slice(0, 80);
    const timestamp = nowIso();
    const requirementTexts = fragments.length ? fragments : [instruction.trim()];
    return requirementTexts.map((text) => {
      const owner = this.ownerForRequirement(text, agents);
      const previously = existing.find((record) => record.text.toLowerCase() === text.toLowerCase());
      if (previously) return { ...previously, status: previously.status === 'completed' ? 'needs-testing' : previously.status, updatedAt: timestamp };
      return {
        id: createId('req'),
        projectId,
        text,
        source: 'user-instruction',
        status: 'needs-testing',
        owner,
        createdAt: timestamp,
        updatedAt: timestamp
      } satisfies RequirementRecord;
    });
  }

  private ownerForRequirement(text: string, agents: AgentRole[]): AgentRole {
    const lower = text.toLowerCase();
    if (/game|sprite|combat|physics|collision|fps|multiplayer|quest|inventory/.test(lower)) return agents.includes('game-engineer') ? 'game-engineer' : 'frontend-engineer';
    if (/pixel|asset|audio|music|sound|art|animation/.test(lower)) return 'asset-engineer';
    if (/api|backend|database|supabase|stripe|email|webhook|auth|server/.test(lower)) return 'backend-engineer';
    if (/security|secret|permission|authorization|rls/.test(lower)) return 'security-engineer';
    if (/performance|optimi|bundle|memory/.test(lower)) return 'performance-engineer';
    if (/test|qa|debug|error|browser/.test(lower)) return 'qa-engineer';
    return 'architect';
  }

  private plan(kind: ProjectKind, instruction: string, agents: AgentRole[]) {
    const plan = [
      'Require a real model provider; block instead of using fake deterministic AI.',
      'Parse requirements and persist them to project memory.',
      'Inspect/index files and create rollback checkpoint before writes.',
      'Ask the real model to produce concrete file patches and commands.',
      'Apply patches to the real project filesystem.',
      'Run install/build/test/audit quality gates and repair failures with the model.',
      'Commit a Git checkpoint only after real filesystem changes.'
    ];
    if (kind === 'game') plan.splice(4, 0, 'Verify the generated game is a playable application, not a screenshot.');
    if (/deploy|vercel|publish/i.test(instruction)) plan.push('Use real deployment/publish pipeline; block if credentials/checks are missing.');
    if (agents.includes('security-engineer')) plan.push('Review auth, secrets, RLS, and server/client boundaries.');
    return plan;
  }

  private saveTask(task: AgentTask) {
    task.updatedAt = nowIso();
    store.update<AgentTask[]>(TASKS_TABLE, [], (tasks) => [task, ...tasks.filter((item) => item.id !== task.id)]);
  }
}

export const forgeOrchestrator = new ForgeOrchestrator();
