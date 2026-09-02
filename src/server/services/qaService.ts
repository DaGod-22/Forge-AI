import fs from 'node:fs';
import path from 'node:path';
import { AgentTask, QualityCheck, QualityGateReport, TaskStatus } from '../../shared/types.js';
import { createId, nowIso } from '../security.js';
import { projectService } from './projectService.js';
import { runCommand } from './commandRunner.js';

function statusFromExit(exitCode: number | null): TaskStatus {
  return exitCode === 0 ? 'passed' : 'failed';
}

function durationMs(startedAt: string, finishedAt: string) {
  return new Date(finishedAt).getTime() - new Date(startedAt).getTime();
}

export class QaService {
  async runQualityGate(projectId: string, options: { install?: boolean; browserUrl?: string } = {}): Promise<QualityGateReport> {
    const project = projectService.getProject(projectId);
    const startedAt = nowIso();
    const checks: QualityCheck[] = [];
    const packagePath = path.join(project.rootPath, 'package.json');

    if (!fs.existsSync(packagePath)) {
      const finishedAt = nowIso();
      return {
        id: createId('qa'),
        projectId,
        status: 'blocked',
        checks: [
          {
            name: 'Project manifest',
            status: 'blocked',
            output: 'No package.json exists yet, so Forge cannot run build/test checks for this project.',
            durationMs: 0
          }
        ],
        startedAt,
        finishedAt,
        summary: 'Quality gate blocked because no executable project manifest exists.'
      };
    }

    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const hasNodeModules = fs.existsSync(path.join(project.rootPath, 'node_modules'));
    if (options.install || !hasNodeModules) {
      checks.push(await this.commandCheck(project.rootPath, 'Dependency install', 'npm install --silent', 180_000));
    }

    if (pkg.scripts?.typecheck) checks.push(await this.commandCheck(project.rootPath, 'Typecheck', 'npm run typecheck', 120_000));
    if (pkg.scripts?.lint) checks.push(await this.commandCheck(project.rootPath, 'Lint', 'npm run lint', 120_000));
    if (pkg.scripts?.test) checks.push(await this.commandCheck(project.rootPath, 'Automated tests', 'npm test', 180_000));
    if (pkg.scripts?.build) checks.push(await this.commandCheck(project.rootPath, 'Production build', 'npm run build', 180_000));

    checks.push(await this.commandCheck(project.rootPath, 'Dependency vulnerability scan', 'npm audit --audit-level=high --omit=dev', 120_000, true));

    if (options.browserUrl) {
      checks.push(await this.httpSmokeCheck(options.browserUrl));
    }

    const failed = checks.filter((check) => check.status === 'failed');
    const blocked = checks.filter((check) => check.status === 'blocked');
    const status: TaskStatus = failed.length ? 'failed' : blocked.length ? 'blocked' : 'passed';
    const finishedAt = nowIso();
    const report: QualityGateReport = {
      id: createId('qa'),
      projectId,
      status,
      checks,
      startedAt,
      finishedAt,
      summary:
        status === 'passed'
          ? `Quality gate passed (${checks.length} checks).`
          : `Quality gate ${status}: ${failed.length} failed, ${blocked.length} blocked.`
    };
    projectService.addMemory(projectId, 'qa', 'Quality gate completed', report.summary, ['qa', status]);
    projectService.updateProject(projectId, { status: status === 'passed' ? 'ready' : 'needs-testing' });
    return report;
  }

  async runTaskQa(task: AgentTask) {
    const report = await this.runQualityGate(task.projectId, { install: true });
    task.qa = report;
    task.status = report.status === 'passed' ? 'passed' : report.status;
    task.updatedAt = nowIso();
    return report;
  }

  private async commandCheck(cwd: string, name: string, command: string, timeoutMs: number, allowFailure = false): Promise<QualityCheck> {
    const result = await runCommand({ cwd, command, timeoutMs, allowFailure: true });
    return {
      name,
      command,
      status: allowFailure ? (result.exitCode === 0 ? 'passed' : 'blocked') : statusFromExit(result.exitCode),
      output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim() || `Command exited with ${result.exitCode}`,
      durationMs: durationMs(result.startedAt, result.finishedAt)
    };
  }

  private async httpSmokeCheck(url: string): Promise<QualityCheck> {
    const started = Date.now();
    try {
      const response = await fetch(url, { redirect: 'follow' });
      const text = await response.text();
      return {
        name: 'Browser HTTP smoke test',
        command: `fetch ${url}`,
        status: response.ok && /<html|<!doctype/i.test(text) ? 'passed' : 'failed',
        output: `HTTP ${response.status}. Received ${text.length} bytes.`,
        durationMs: Date.now() - started
      };
    } catch (error) {
      return {
        name: 'Browser HTTP smoke test',
        command: `fetch ${url}`,
        status: 'failed',
        output: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started
      };
    }
  }
}

export const qaService = new QaService();
