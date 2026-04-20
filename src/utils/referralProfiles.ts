import { randomBytes } from 'crypto';
import { query } from '../db';
import { normalizeMobileDigits } from './referralAuth';

const randomId = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;

export const normalizeCountryCode = (countryCode?: string) => {
  const cleanCountryCode = normalizeMobileDigits(countryCode || '');
  return cleanCountryCode || '60';
};

export const buildInternationalPhone = (countryCode: string, localPhone: string) => {
  const digits = normalizeMobileDigits(localPhone);
  if (!digits) return countryCode;

  if (digits.startsWith('0')) {
    return `${countryCode}${digits.slice(1)}`;
  }

  return `${countryCode}${digits}`;
};

export const normalizeReferralLocalPhone = (countryCode: string, localPhone: string) => {
  const digits = normalizeMobileDigits(localPhone);

  if (!digits) return '';

  if (countryCode === '60') {
    return digits.startsWith('0') ? digits : `0${digits}`;
  }

  return digits;
};

export const getReferralPhoneCandidates = (countryCode: string, localPhone: string) => {
  const digits = normalizeMobileDigits(localPhone);
  const candidates = new Set<string>();

  if (!digits) return [];

  candidates.add(digits);

  if (countryCode === '60') {
    candidates.add(digits.startsWith('0') ? digits.slice(1) : digits);
    candidates.add(digits.startsWith('0') ? digits : `0${digits}`);
  }

  return Array.from(candidates).filter(Boolean);
};

export const findReferralByMobile = async (countryCode: string, localPhone: string) =>
  query(
    `SELECT r.*
     FROM referral r
     WHERE regexp_replace(coalesce(r.mobile_number, ''), '\D', '', 'g') = ANY($1::text[])
     ORDER BY r.id ASC
     LIMIT 1`,
    [getReferralPhoneCandidates(countryCode, localPhone)]
  );

export const createReferralProfile = async (countryCode: string, localPhone: string, name?: string) => {
  const customerId = randomId('cust');
  const referralBubbleId = randomId('ref');
  const displayPhone = normalizeReferralLocalPhone(countryCode, localPhone);
  const displayName = (name || '').trim() || `Referral ${displayPhone}`;

  await query(
    `INSERT INTO customer (customer_id, name, phone, lead_source, created_at, updated_at)
     VALUES ($1, $2, $3, 'referral', NOW(), NOW())`,
    [customerId, displayName, displayPhone]
  );

  const insertedReferral = await query(
    `INSERT INTO referral (bubble_id, linked_customer_profile, name, mobile_number, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Pending', NOW(), NOW())
     RETURNING *`,
    [referralBubbleId, customerId, displayName, displayPhone]
  );

  return insertedReferral.rows[0];
};

export const createOrFindReferralProfile = async (countryCode: string, localPhone: string, name?: string) => {
  const existing = await findReferralByMobile(countryCode, localPhone);

  if (existing.rows.length > 0) {
    return {
      created: false,
      referral: existing.rows[0]
    };
  }

  const referral = await createReferralProfile(countryCode, localPhone, name);

  return {
    created: true,
    referral
  };
};
