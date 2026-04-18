import { Pool, type PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isSslDisabled = () => {
  const value = (process.env.DB_SSL || process.env.PGSSLMODE || '').toLowerCase();
  return value === 'false' || value === 'disable';
};

const getSslConfig = () => {
  if (isSslDisabled()) {
    return false;
  }

  return {
    rejectUnauthorized: false
  };
};

const buildPoolConfig = (): PoolConfig => {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ssl: getSslConfig()
    };
  }

  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE?.trim();

  if (!host || !user || password === undefined || !database) {
    throw new Error(
      'Database configuration missing. Set DATABASE_URL or PGHOST, PGUSER, PGPASSWORD, and PGDATABASE.'
    );
  }

  return {
    host,
    port: Number(process.env.PGPORT || 5432),
    user,
    password,
    database,
    ssl: getSslConfig()
  };
};

const getConnectionHint = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (/password authentication failed/i.test(message)) {
    return 'Postgres rejected the username/password. If you rotated the DB password, restart the app after updating env vars.';
  }

  if (/invalid connection string|URI malformed|ENOTFOUND|getaddrinfo|ECONNREFUSED/i.test(message)) {
    return 'Check DATABASE_URL formatting. If the password contains special characters like @, :, /, or %, URL-encode it or switch to PGHOST/PGUSER/PGPASSWORD/PGDATABASE.';
  }

  return 'Verify the database host, port, database name, and SSL settings.';
};

const pool = new Pool(buildPoolConfig());

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

export const assertDatabaseConnection = async () => {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error('Failed to connect to PostgreSQL:', error);
    console.error(getConnectionHint(error));
    throw error;
  }
};

export const query = (text: string, params?: any[]) => pool.query(text, params);

export const getDatabaseConfigSource = () =>
  process.env.DATABASE_URL?.trim() ? 'DATABASE_URL' : 'PG_ENV';
