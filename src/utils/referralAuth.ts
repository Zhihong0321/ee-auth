import { query } from '../db';

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '');

export const normalizeMobileDigits = (value: string) => value.replace(/\D/g, '');

export const getReferralAuthUrls = async (): Promise<string[]> => {
  const result = await query('SELECT url FROM auth_hub_referral_auth_urls ORDER BY created_at DESC');
  return result.rows.map((row: { url: string }) => normalizeUrl(row.url));
};

export const isReferralAuthReturnTo = async (returnTo?: string): Promise<boolean> => {
  if (!returnTo) return false;

  const normalizedReturnTo = normalizeUrl(returnTo);
  if (!normalizedReturnTo.startsWith('http')) return false;

  const urls = await getReferralAuthUrls();
  return urls.includes(normalizedReturnTo);
};

export const ensureReferralAuthSchema = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS auth_hub_referral_auth_urls (
      url VARCHAR(2048) PRIMARY KEY,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `);
};

