import { DeploymentRecord, EnvironmentName, QualityCheck } from '../../shared/types.js';
import { createId, nowIso } from '../security.js';
import { store } from '../store.js';
import { integrationService } from './integrations.js';
import { projectService } from './projectService.js';
import { qaService } from './qaService.js';
import { runCommand } from './commandRunner.js';
import { findFreePort, startProjectProcess } from './processManager.js';

const DEPLOYMENTS_TABLE = 'deployments';

export class DeploymentService {
  list(projectId: string) {
    return store.read<DeploymentRecord[]>(DEPLOYMENTS_TABLE, []).filter((deployment) => deployment.projectId === projectId);
  }

  async deployVercel(projectId: string, environment: EnvironmentName = 'preview') {
    const project = projectService.getProject(projectId);
    const timestamp = nowIso();
    const record: DeploymentRecord = {
      id: createId('deploy'),
      projectId,
      provider: 'vercel',
      environment,
      status: 'building',
      logs: [],
      checks: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.save(record);

    const qa = await qaService.runQualityGate(projectId, { install: false });
    record.checks = qa.checks;
    record.logs.push(qa.summary);
    if (qa.status !== 'passed') {
      record.status = 'blocked';
      record.logs.push('Deployment blocked because the quality gate did not pass.');
      record.updatedAt = nowIso();
      this.save(record);
      return record;
    }

    const token = integrationService.getSecret('vercel', environment, 'VERCEL_TOKEN') || integrationService.getSecret('vercel', 'development', 'VERCEL_TOKEN');
    if (!token) {
      record.status = 'blocked';
      record.logs.push('Deployment blocked: connect Vercel and provide VERCEL_TOKEN in the Integrations Hub.');
      record.updatedAt = nowIso();
      this.save(record);
      return record;
    }

    const prodFlag = environment === 'production' ? '--prod' : '';
    const result = await runCommand({
      cwd: project.rootPath,
      command: `npx vercel deploy ${prodFlag} --yes`,
      timeoutMs: 300_000,
      allowFailure: true,
      env: { VERCEL_TOKEN: token }
    });
    // The real token is provided only as an environment variable and is redacted from captured output.
    const output = `${result.stdout}\n${result.stderr}`.trim();
    record.logs.push(output);
    const url = output.split(/\s+/).find((part) => /^https:\/\/.+vercel\.app/.test(part));
    record.url = url;
    record.status = result.exitCode === 0 && url ? 'ready' : 'failed';
    record.updatedAt = nowIso();
    this.save(record);
    projectService.addMemory(projectId, 'deployment', `Vercel deployment ${record.status}`, record.url || output.slice(0, 1000), ['deployment', environment]);
    return record;
  }

  async publishArenaPreview(projectId: string) {
    const project = projectService.getProject(projectId);
    const timestamp = nowIso();
    const record: DeploymentRecord = {
      id: createId('deploy'),
      projectId,
      provider: 'arena',
      environment: 'preview',
      status: 'building',
      logs: ['Running real QA before publishing an Arena share URL.'],
      checks: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.save(record);

    const qa = await qaService.runQualityGate(projectId, { install: true });
    record.checks = qa.checks;
    record.logs.push(qa.summary);
    if (qa.status !== 'passed') {
      record.status = 'blocked';
      record.logs.push('Arena publish blocked because tests/build did not pass.');
      record.updatedAt = nowIso();
      this.save(record);
      return record;
    }

    const port = await findFreePort(4400);
    const previewProcess = await startProjectProcess({
      projectId,
      cwd: project.rootPath,
      name: `${project.name} published preview`,
      command: 'npm run dev',
      port
    });
    const sandboxId = process.env.E2B_SANDBOX_ID;
    record.url = `/run/${projectId}/`;
    record.status = previewProcess.status === 'failed' ? 'failed' : 'ready';
    record.logs.push(...previewProcess.logs.slice(-20));
    record.logs.push(`Same-origin Forge preview path: ${record.url}`);
    record.logs.push(`Internal sandbox port: ${port}${sandboxId ? ` (${port}-${sandboxId}.e2b.app requires Arena traffic token outside the preview UI)` : ''}`);
    record.updatedAt = nowIso();
    projectService.updateProject(projectId, { preview: { processId: previewProcess.id, port, command: previewProcess.command, startedAt: previewProcess.startedAt }, status: record.status === 'ready' ? 'deployed' : 'needs-testing' });
    this.save(record);
    return record;
  }

  private save(record: DeploymentRecord) {
    store.update<DeploymentRecord[]>(DEPLOYMENTS_TABLE, [], (records) => [record, ...records.filter((item) => item.id !== record.id)]);
  }

  createStaticArtifact(projectId: string, checks: QualityCheck[] = []) {
    const project = projectService.getProject(projectId);
    const timestamp = nowIso();
    const record: DeploymentRecord = {
      id: createId('deploy'),
      projectId,
      provider: 'static',
      environment: 'preview',
      status: 'ready',
      logs: [`Static artifact prepared from ${project.rootPath}. Upload dist/ to your hosting provider.`],
      checks,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.save(record);
    return record;
  }
}

export const deploymentService = new DeploymentService();
