import { store } from '../store.js';
import { createId, decryptSecret, encryptSecret, fingerprint, nowIso } from '../security.js';
import { EnvironmentName, IntegrationConnection, IntegrationDefinition, SecretReference } from '../../shared/types.js';

interface StoredSecret extends SecretReference {
  value: string;
}

const CONNECTIONS_TABLE = 'integration-connections';
const SECRETS_TABLE = 'secrets';

export const integrationRegistry: IntegrationDefinition[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'source-control',
    description: 'Repository import, branching, commits, diffs, pull requests, history, and AI-assisted review workflows.',
    authMethod: 'oauth',
    requiredCredentials: [
      {
        key: 'GITHUB_TOKEN',
        label: 'GitHub token or gh CLI session',
        environment: 'all',
        secret: true,
        required: false,
        description: 'Optional. Forge can also use the authenticated gh CLI session available on the server.'
      }
    ],
    operations: ['browse repositories', 'clone/import', 'create repositories', 'push/pull', 'branches', 'commits', 'diffs', 'pull requests', 'history', 'restore versions'],
    documentationUrl: 'https://docs.github.com/en/rest',
    scopes: ['repo', 'read:user', 'workflow'],
    secretHandling: 'Tokens are encrypted server-side and never written to generated frontend code.'
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'deployment',
    description: 'Preview and production deployments with build logs, environment variables, custom domains, and rollback metadata.',
    authMethod: 'access-token',
    requiredCredentials: [
      { key: 'VERCEL_TOKEN', label: 'Vercel access token', environment: 'all', secret: true, required: true, description: 'Used only as a server-side environment variable for vercel CLI/API calls.' },
      { key: 'VERCEL_ORG_ID', label: 'Vercel team/org id', environment: 'all', secret: false, required: false, description: 'Optional team scope.' },
      { key: 'VERCEL_PROJECT_ID', label: 'Vercel project id', environment: 'all', secret: false, required: false, description: 'Optional existing Vercel project.' }
    ],
    operations: ['create project', 'deploy preview', 'deploy production', 'read deployments', 'logs', 'domains', 'environment variables', 'rollback'],
    documentationUrl: 'https://vercel.com/docs/rest-api',
    scopes: ['deployments', 'projects', 'env', 'domains'],
    secretHandling: 'Deployment tokens are redacted from command output and never exposed to the client.'
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'database',
    description: 'PostgreSQL, Auth, Storage, Realtime, Edge Functions, migrations, RLS, and schema inspection.',
    authMethod: 'api-key',
    requiredCredentials: [
      { key: 'SUPABASE_URL', label: 'Supabase URL', environment: 'all', secret: false, required: true, description: 'Public project URL.' },
      { key: 'SUPABASE_ANON_KEY', label: 'Supabase anon key', environment: 'all', secret: false, required: true, description: 'Publishable key safe for browser usage with RLS.' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase service role key', environment: 'all', secret: true, required: false, description: 'Server-only administrative key. Forge will not emit it to client code.' },
      { key: 'SUPABASE_DB_URL', label: 'Supabase PostgreSQL connection string', environment: 'all', secret: true, required: false, description: 'Used server-side to apply/inspect real PostgreSQL migrations when authorized.' }
    ],
    operations: ['auth', 'tables', 'relationships', 'indexes', 'migrations', 'RLS policies', 'storage buckets', 'realtime', 'edge functions', 'schema inspection'],
    documentationUrl: 'https://supabase.com/docs',
    scopes: ['database', 'auth', 'storage', 'realtime'],
    secretHandling: 'Service role keys are server-only; generated browser code receives only URL and anon keys.'
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    description: 'Products, prices, Checkout, subscriptions, webhooks, customer portal, and payment status.',
    authMethod: 'api-key',
    requiredCredentials: [
      { key: 'STRIPE_SECRET_KEY', label: 'Stripe secret key', environment: 'all', secret: true, required: true, description: 'Server-side Stripe API key.' },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook secret', environment: 'all', secret: true, required: false, description: 'Used to verify incoming webhook signatures.' },
      { key: 'VITE_STRIPE_PUBLISHABLE_KEY', label: 'Stripe publishable key', environment: 'all', secret: false, required: false, description: 'Client-safe publishable key.' }
    ],
    operations: ['products', 'prices', 'checkout', 'subscriptions', 'webhooks', 'customer portal', 'payment status'],
    documentationUrl: 'https://docs.stripe.com',
    scopes: ['payments', 'customers', 'subscriptions', 'webhooks'],
    secretHandling: 'Secret keys are only injected into backend/serverless functions.'
  },
  {
    id: 'resend',
    name: 'Resend',
    category: 'email',
    description: 'Transactional email for verification, password reset, notifications, and welcome workflows.',
    authMethod: 'api-key',
    requiredCredentials: [
      { key: 'RESEND_API_KEY', label: 'Resend API key', environment: 'all', secret: true, required: true, description: 'Server-only email API key.' },
      { key: 'RESEND_FROM_EMAIL', label: 'Default from email', environment: 'all', secret: false, required: true, description: 'Verified sender address.' }
    ],
    operations: ['verification email', 'password reset', 'notifications', 'transactional email', 'welcome email'],
    documentationUrl: 'https://resend.com/docs',
    scopes: ['send:email'],
    secretHandling: 'API keys stay encrypted and server-side.'
  },
  {
    id: 's3',
    name: 'S3-compatible Storage',
    category: 'storage',
    description: 'Object storage for uploads, downloads, image storage, file management, and access control.',
    authMethod: 'api-key',
    requiredCredentials: [
      { key: 'S3_ENDPOINT', label: 'Endpoint', environment: 'all', secret: false, required: false, description: 'S3-compatible endpoint.' },
      { key: 'S3_ACCESS_KEY_ID', label: 'Access key id', environment: 'all', secret: true, required: true, description: 'Server-side access key id.' },
      { key: 'S3_SECRET_ACCESS_KEY', label: 'Secret access key', environment: 'all', secret: true, required: true, description: 'Server-side access key secret.' },
      { key: 'S3_BUCKET', label: 'Bucket', environment: 'all', secret: false, required: true, description: 'Default bucket.' }
    ],
    operations: ['uploads', 'downloads', 'signed URLs', 'image storage', 'file management', 'ACLs'],
    documentationUrl: 'https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html',
    scopes: ['objects:read', 'objects:write'],
    secretHandling: 'Access credentials never leave the server.'
  },
  {
    id: 'custom-api',
    name: 'Custom API / Webhook',
    category: 'api',
    description: 'Generic REST, GraphQL, OAuth, API key, JSON endpoint, and webhook integration profile.',
    authMethod: 'api-key',
    requiredCredentials: [
      { key: 'CUSTOM_API_BASE_URL', label: 'Base URL', environment: 'all', secret: false, required: true, description: 'API root URL.' },
      { key: 'CUSTOM_API_KEY', label: 'API key/token', environment: 'all', secret: true, required: false, description: 'Optional server-side credential.' }
    ],
    operations: ['REST', 'GraphQL', 'webhooks', 'OAuth callbacks', 'API keys', 'JSON endpoints'],
    documentationUrl: 'https://www.openapis.org',
    scopes: ['custom'],
    secretHandling: 'Credentials are encrypted and only referenced by symbolic names in generated code.'
  }
];

export class IntegrationService {
  registry() {
    return integrationRegistry;
  }

  listConnections() {
    return store.read<IntegrationConnection[]>(CONNECTIONS_TABLE, []);
  }

  getConnection(id: string) {
    const connection = this.listConnections().find((record) => record.id === id || record.integrationId === id);
    if (!connection) throw new Error(`Unknown integration connection ${id}`);
    return connection;
  }

  upsertConnection(input: {
    integrationId: string;
    name?: string;
    environments?: EnvironmentName[];
    credentials?: Record<string, string>;
    environment?: EnvironmentName;
  }) {
    const definition = integrationRegistry.find((item) => item.id === input.integrationId);
    if (!definition) throw new Error(`Unknown integration ${input.integrationId}`);
    const timestamp = nowIso();
    const envs = input.environments?.length ? input.environments : [input.environment || 'development'];
    const keys = Object.keys(input.credentials || {});
    let connection = this.listConnections().find((item) => item.integrationId === input.integrationId);
    if (!connection) {
      connection = {
        id: createId('connection'),
        integrationId: input.integrationId,
        name: input.name || definition.name,
        environments: envs,
        credentialKeys: keys,
        status: keys.length ? 'connected' : 'needs-credentials',
        createdAt: timestamp,
        updatedAt: timestamp
      };
    } else {
      connection = {
        ...connection,
        name: input.name || connection.name,
        environments: Array.from(new Set([...connection.environments, ...envs])),
        credentialKeys: Array.from(new Set([...connection.credentialKeys, ...keys])),
        status: keys.length || connection.credentialKeys.length ? 'connected' : 'needs-credentials',
        updatedAt: timestamp
      };
    }
    if (input.credentials) {
      for (const [key, value] of Object.entries(input.credentials)) {
        if (value) this.setSecret(input.integrationId, input.environment || 'development', key, value);
      }
    }
    store.update<IntegrationConnection[]>(CONNECTIONS_TABLE, [], (records) => [connection!, ...records.filter((item) => item.id !== connection!.id)]);
    return connection;
  }

  setSecret(integrationId: string, environment: EnvironmentName, key: string, value: string) {
    const timestamp = nowIso();
    const secret: StoredSecret = {
      key,
      integrationId,
      environment,
      fingerprint: fingerprint(value),
      value: encryptSecret(value),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.update<StoredSecret[]>(SECRETS_TABLE, [], (records) => [
      secret,
      ...records.filter((record) => !(record.integrationId === integrationId && record.environment === environment && record.key === key))
    ]);
    return this.publicSecret(secret);
  }

  listSecretReferences(integrationId?: string) {
    return store
      .read<StoredSecret[]>(SECRETS_TABLE, [])
      .filter((secret) => !integrationId || secret.integrationId === integrationId)
      .map((secret) => this.publicSecret(secret));
  }

  getSecret(integrationId: string, environment: EnvironmentName, key: string) {
    const stored = store
      .read<StoredSecret[]>(SECRETS_TABLE, [])
      .find((secret) => secret.integrationId === integrationId && secret.environment === environment && secret.key === key);
    if (stored) return decryptSecret(stored.value);
    const envValue = process.env[key];
    return envValue || undefined;
  }

  hasCredential(integrationId: string, environment: EnvironmentName, key: string) {
    return Boolean(this.getSecret(integrationId, environment, key));
  }

  private publicSecret(secret: StoredSecret): SecretReference {
    const { value: _value, ...publicSecret } = secret;
    return publicSecret;
  }
}

export const integrationService = new IntegrationService();
