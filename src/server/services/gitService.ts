import fs from 'node:fs';
import path from 'node:path';
import { projectService } from './projectService.js';
import { runCommand } from './commandRunner.js';

export class GitService {
  async ensureRepository(projectId: string) {
    const project = projectService.getProject(projectId);
    const gitDir = path.join(project.rootPath, '.git');
    if (!fs.existsSync(gitDir)) {
      await runCommand({ cwd: project.rootPath, command: 'git init', timeoutMs: 30_000, allowFailure: true });
      await runCommand({ cwd: project.rootPath, command: 'git config user.email forge-ai@local.dev', timeoutMs: 10_000, allowFailure: true });
      await runCommand({ cwd: project.rootPath, command: 'git config user.name "Forge AI"', timeoutMs: 10_000, allowFailure: true });
    }
    return { initialized: true };
  }

  async status(projectId: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    const [status, branch, log] = await Promise.all([
      runCommand({ cwd: project.rootPath, command: 'git status --short', timeoutMs: 20_000, allowFailure: true }),
      runCommand({ cwd: project.rootPath, command: 'git branch --show-current', timeoutMs: 20_000, allowFailure: true }),
      runCommand({ cwd: project.rootPath, command: 'git log --oneline --decorate -n 20', timeoutMs: 20_000, allowFailure: true })
    ]);
    return { status, branch: branch.stdout.trim() || 'main', log: log.stdout.trim() };
  }

  async diff(projectId: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    return runCommand({ cwd: project.rootPath, command: 'git diff -- .', timeoutMs: 30_000, allowFailure: true });
  }

  async createBranch(projectId: string, branch: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('Invalid branch name');
    return runCommand({ cwd: project.rootPath, command: `git switch -c ${branch}`, timeoutMs: 30_000, allowFailure: true });
  }

  async switchBranch(projectId: string, branch: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('Invalid branch name');
    return runCommand({ cwd: project.rootPath, command: `git switch ${branch}`, timeoutMs: 30_000, allowFailure: true });
  }

  async commit(projectId: string, message: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    const safeMessage = message.replace(/["`$\\;|&<>\n\r]/g, '').slice(0, 160) || 'Forge AI checkpoint';
    const add = await runCommand({ cwd: project.rootPath, command: 'git add .', timeoutMs: 60_000, allowFailure: true });
    const commit = await runCommand({ cwd: project.rootPath, command: `git commit -m "${safeMessage}"`, timeoutMs: 60_000, allowFailure: true });
    return { add, commit };
  }

  async cloneIntoProject(projectId: string, repositoryUrl: string) {
    const project = projectService.getProject(projectId);
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repositoryUrl)) {
      throw new Error('For safety, Forge currently imports GitHub HTTPS repository URLs only.');
    }
    const existing = fs.readdirSync(project.rootPath).filter((entry) => entry !== '.git');
    if (existing.length) throw new Error('Project workspace is not empty. Create a new project before importing a repository.');
    return runCommand({ cwd: project.rootPath, command: `git clone ${repositoryUrl} .`, timeoutMs: 180_000, allowFailure: true });
  }

  async push(projectId: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    return runCommand({ cwd: project.rootPath, command: 'git push', timeoutMs: 120_000, allowFailure: true });
  }

  async pull(projectId: string) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    return runCommand({ cwd: project.rootPath, command: 'git pull --ff-only', timeoutMs: 120_000, allowFailure: true });
  }

  async githubRepos() {
    return runCommand({ cwd: process.cwd(), command: 'gh repo list --limit 50', timeoutMs: 60_000, allowFailure: true });
  }

  async createGithubRepository(projectId: string, name: string, isPrivate = true) {
    const project = projectService.getProject(projectId);
    await this.ensureRepository(projectId);
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Invalid GitHub repository name');
    const visibility = isPrivate ? '--private' : '--public';
    return runCommand({ cwd: project.rootPath, command: `gh repo create ${name} --source . --remote origin --push ${visibility}`, timeoutMs: 180_000, allowFailure: true });
  }

  async createPullRequest(projectId: string, title: string, body: string) {
    const project = projectService.getProject(projectId);
    const safeTitle = title.replace(/["`$\\;|&<>\n\r]/g, '').slice(0, 160) || 'Forge AI changes';
    const safeBody = body.replace(/["`$\\;|&<>]/g, '').slice(0, 4000);
    return runCommand({ cwd: project.rootPath, command: `gh pr create --title "${safeTitle}" --body "${safeBody}"`, timeoutMs: 60_000, allowFailure: true });
  }
}

export const gitService = new GitService();
