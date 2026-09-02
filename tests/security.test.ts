import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { redactSecrets, safeJoin, slugify } from '../src/server/security';

describe('Forge security helpers', () => {
  it('slugifies project names predictably', () => {
    expect(slugify('My Huge SaaS!!!')).toBe('my-huge-saas');
  });

  it('prevents path traversal out of a project root', () => {
    expect(() => safeJoin('/tmp/project', '../secret')).toThrow(/escapes/);
    expect(safeJoin('/tmp/project', 'src/App.tsx')).toBe(path.resolve('/tmp/project/src/App.tsx'));
  });

  it('redacts common secret formats from command output', () => {
    expect(redactSecrets('STRIPE_SECRET_KEY=sk_live_123456789abcdefghijkl')).toContain('[REDACTED');
    expect(redactSecrets('token ghp_abcdefghijklmnopqrstuvwxyz123456')).toContain('[REDACTED_GITHUB_TOKEN]');
  });
});
