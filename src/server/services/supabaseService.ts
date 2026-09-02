import fs from 'node:fs';
import path from 'node:path';
import { EnvironmentName } from '../../shared/types.js';
import { redactSecrets } from '../security.js';
import { integrationService } from './integrations.js';
import { projectService } from './projectService.js';

export interface SupabaseApplyResult {
  status: 'applied' | 'blocked' | 'failed';
  appliedMigrations: string[];
  output: string;
}

export interface SupabaseSchemaInspection {
  status: 'ready' | 'blocked' | 'failed';
  tables: { table_schema: string; table_name: string; columns: number }[];
  policies: { schemaname: string; tablename: string; policyname: string }[];
  output: string;
}

export class SupabaseService {
  private getDbUrl(environment: EnvironmentName) {
    return integrationService.getSecret('supabase', environment, 'SUPABASE_DB_URL') || integrationService.getSecret('supabase', 'development', 'SUPABASE_DB_URL');
  }

  async applyMigrations(projectId: string, environment: EnvironmentName = 'development'): Promise<SupabaseApplyResult> {
    const dbUrl = this.getDbUrl(environment);
    if (!dbUrl) {
      return {
        status: 'blocked',
        appliedMigrations: [],
        output: 'SUPABASE_DB_URL is not connected. Forge did not modify Supabase. Add the database connection string in Integrations, then retry.'
      };
    }
    const project = projectService.getProject(projectId);
    const migrationsDir = path.join(project.rootPath, 'supabase/migrations');
    if (!fs.existsSync(migrationsDir)) return { status: 'blocked', appliedMigrations: [], output: 'No supabase/migrations directory exists for this project.' };
    const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
    if (!migrationFiles.length) return { status: 'blocked', appliedMigrations: [], output: 'No SQL migration files exist.' };

    try {
      const postgres = (await import('postgres')).default;
      const sql = postgres(dbUrl, { max: 1, ssl: 'require', idle_timeout: 5, connect_timeout: 20 });
      const applied: string[] = [];
      try {
        await sql`create schema if not exists forge_ai`;
        await sql`create table if not exists forge_ai.applied_migrations (name text primary key, applied_at timestamptz not null default now())`;
        for (const file of migrationFiles) {
          const already = await sql`select name from forge_ai.applied_migrations where name = ${file}`;
          if (already.length) continue;
          const body = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
          await sql.begin(async (tx) => {
            await tx.unsafe(body);
            await tx`insert into forge_ai.applied_migrations (name) values (${file})`;
          });
          applied.push(file);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
      return { status: 'applied', appliedMigrations: applied, output: applied.length ? `Applied ${applied.length} migrations.` : 'All migrations were already applied.' };
    } catch (error) {
      return { status: 'failed', appliedMigrations: [], output: redactSecrets(error instanceof Error ? error.message : String(error)) };
    }
  }

  async inspectSchema(environment: EnvironmentName = 'development'): Promise<SupabaseSchemaInspection> {
    const dbUrl = this.getDbUrl(environment);
    if (!dbUrl) {
      return { status: 'blocked', tables: [], policies: [], output: 'SUPABASE_DB_URL is not connected. Schema inspection did not run.' };
    }
    try {
      const postgres = (await import('postgres')).default;
      const sql = postgres(dbUrl, { max: 1, ssl: 'require', idle_timeout: 5, connect_timeout: 20 });
      try {
        const tables = await sql<{ table_schema: string; table_name: string; columns: number }[]>`
          select table_schema, table_name, count(*)::int as columns
          from information_schema.columns
          where table_schema not in ('pg_catalog', 'information_schema')
          group by table_schema, table_name
          order by table_schema, table_name
        `;
        const policies = await sql<{ schemaname: string; tablename: string; policyname: string }[]>`
          select schemaname, tablename, policyname
          from pg_policies
          order by schemaname, tablename, policyname
        `;
        return { status: 'ready', tables: [...tables], policies: [...policies], output: `Found ${tables.length} tables and ${policies.length} policies.` };
      } finally {
        await sql.end({ timeout: 5 });
      }
    } catch (error) {
      return { status: 'failed', tables: [], policies: [], output: redactSecrets(error instanceof Error ? error.message : String(error)) };
    }
  }

  async createStorageBucket(name: string, environment: EnvironmentName = 'development') {
    const url = integrationService.getSecret('supabase', environment, 'SUPABASE_URL') || integrationService.getSecret('supabase', 'development', 'SUPABASE_URL');
    const key = integrationService.getSecret('supabase', environment, 'SUPABASE_SERVICE_ROLE_KEY') || integrationService.getSecret('supabase', 'development', 'SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return { status: 'blocked', output: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Bucket was not created.' };
    const response = await fetch(`${url.replace(/\/$/, '')}/storage/v1/bucket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ id: name, name, public: false })
    });
    const text = await response.text();
    return { status: response.ok || response.status === 409 ? 'ready' : 'failed', output: redactSecrets(text || `HTTP ${response.status}`) };
  }
}

export const supabaseService = new SupabaseService();
