import axios from 'axios';
import { getDatabaseConfigSource, query } from './db';

const SERVICE_NAME = 'ee-auth';
const DEFAULT_JWT_SECRET = 'default_secret';
const DEFAULT_COOKIE_DOMAIN = '.atap.solar';
const DEFAULT_WHATSAPP_SESSION_ID = 'eternalgy-auth';
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 5000);

type HealthState = 'ok' | 'warn' | 'fail';

type HealthCheck = {
  name: string;
  status: HealthState;
  required: boolean;
  latencyMs?: number;
  details?: string;
  meta?: Record<string, unknown>;
};

type HealthSummary = {
  service: string;
  status: 'ok' | 'degraded' | 'fail';
  timestamp: string;
  uptimeSeconds: number;
  checks: Record<string, HealthCheck>;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const buildCheck = async (
  name: string,
  required: boolean,
  run: () => Promise<Omit<HealthCheck, 'name' | 'required'>>
): Promise<HealthCheck> => {
  const startedAt = Date.now();

  try {
    const result = await run();
    return {
      name,
      required,
      latencyMs: result.latencyMs ?? Date.now() - startedAt,
      ...result
    };
  } catch (error) {
    return {
      name,
      required,
      status: 'fail',
      latencyMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error)
    };
  }
};

const checkConfiguration = async (): Promise<Omit<HealthCheck, 'name' | 'required'>> => {
  const hasDatabaseConfig = Boolean(
    process.env.DATABASE_URL?.trim() ||
      (
        process.env.PGHOST?.trim() &&
        process.env.PGUSER?.trim() &&
        process.env.PGPASSWORD !== undefined &&
        process.env.PGDATABASE?.trim()
      )
  );

  const missing: string[] = [];
  const warnings: string[] = [];

  if (!hasDatabaseConfig) missing.push('DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE');
  if (!process.env.WHATSAPP_API_URL?.trim()) missing.push('WHATSAPP_API_URL');
  if (!process.env.JWT_SECRET?.trim()) {
    missing.push('JWT_SECRET');
  } else if (process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    warnings.push('JWT_SECRET is still using the default value');
  }

  if (!process.env.COOKIE_DOMAIN?.trim()) {
    warnings.push(`COOKIE_DOMAIN is not set; defaulting to ${DEFAULT_COOKIE_DOMAIN}`);
  }

  const status: HealthState = missing.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'ok';
  const details = [
    missing.length > 0 ? `Missing: ${missing.join(', ')}` : '',
    warnings.length > 0 ? `Warnings: ${warnings.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    status,
    details: details || 'Required configuration present',
    meta: {
      databaseConfigSource: hasDatabaseConfig ? getDatabaseConfigSource() : 'missing',
      whatsappSessionId: process.env.WHATSAPP_SESSION_ID || DEFAULT_WHATSAPP_SESSION_ID
    }
  };
};

const checkDatabase = async (): Promise<Omit<HealthCheck, 'name' | 'required'>> => {
  await withTimeout(query('SELECT 1 AS ok'), HEALTH_TIMEOUT_MS, 'database health check');

  return {
    status: 'ok',
    details: 'Database query succeeded',
    meta: {
      configSource: getDatabaseConfigSource()
    }
  };
};

const checkWhatsapp = async (): Promise<Omit<HealthCheck, 'name' | 'required'>> => {
  const apiUrl = process.env.WHATSAPP_API_URL?.trim().replace(/\/$/, '');
  const sessionId = process.env.WHATSAPP_SESSION_ID || DEFAULT_WHATSAPP_SESSION_ID;

  if (!apiUrl) {
    return {
      status: 'fail',
      details: 'WHATSAPP_API_URL is not configured'
    };
  }

  const response = await withTimeout(
    axios.get(`${apiUrl}/sessions/${encodeURIComponent(sessionId)}`, {
      timeout: HEALTH_TIMEOUT_MS
    }),
    HEALTH_TIMEOUT_MS,
    'whatsapp health check'
  );

  const session = response.data as { status?: string; error?: string | null; message?: string | null };
  const sessionStatus = session?.status || 'unknown';

  if (sessionStatus !== 'connected') {
    return {
      status: 'fail',
      details: session?.error || session?.message || `WhatsApp session "${sessionId}" is ${sessionStatus}`,
      meta: {
        sessionStatus
      }
    };
  }

  return {
    status: 'ok',
    details: `WhatsApp session "${sessionId}" is connected`,
    meta: {
      sessionStatus
    }
  };
};

const summarizeStatus = (checks: HealthCheck[]): HealthSummary['status'] => {
  if (checks.some((check) => check.required && check.status === 'fail')) {
    return 'fail';
  }

  if (checks.some((check) => check.status !== 'ok')) {
    return 'degraded';
  }

  return 'ok';
};

export const getLiveness = () => ({
  service: SERVICE_NAME,
  status: 'ok' as const,
  timestamp: new Date().toISOString(),
  uptimeSeconds: Math.round(process.uptime())
});

export const getHealthSummary = async (): Promise<HealthSummary> => {
  const checks = await Promise.all([
    buildCheck('configuration', true, checkConfiguration),
    buildCheck('database', true, checkDatabase),
    buildCheck('whatsapp', true, checkWhatsapp)
  ]);

  return {
    service: SERVICE_NAME,
    status: summarizeStatus(checks),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: Object.fromEntries(checks.map((check) => [check.name, check]))
  };
};

export const isReady = (summary: HealthSummary) => summary.status !== 'fail';
