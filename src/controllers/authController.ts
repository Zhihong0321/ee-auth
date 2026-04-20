import { Request, Response } from 'express';
import { query } from '../db';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { analyzeEmployeeAuthAttempt, lookupRegisteredMobilesByEmail } from '../utils/authDiagnostics';
import { isReferralAuthReturnTo } from '../utils/referralAuth';
import {
  buildInternationalPhone,
  createReferralProfile,
  findReferralByMobile,
  normalizeCountryCode,
  normalizeReferralLocalPhone
} from '../utils/referralProfiles';

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.atap.solar';
const WA_API_URL = process.env.WHATSAPP_API_URL;
const WHATSAPP_SESSION_ID = process.env.WHATSAPP_SESSION_ID || 'eternalgy-auth';
const WHATSAPP_TIMEOUT_MS = Number(process.env.WHATSAPP_TIMEOUT_MS || 15000);
const WHATSAPP_SESSION_RETRY_DELAY_MS = Number(process.env.WHATSAPP_SESSION_RETRY_DELAY_MS || 1500);

const sanitizePhone = (phone: string) => phone.replace(/\D/g, '');

type WhatsappSessionStatus = {
  status?: string;
  error?: string | null;
  message?: string | null;
  qr?: string | null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getWhatsappSessionUrl = (safeApiUrl: string) =>
  `${safeApiUrl}/sessions/${encodeURIComponent(WHATSAPP_SESSION_ID)}`;

const isWhatsappSessionReady = (session?: WhatsappSessionStatus) => {
  if (!session) return false;
  return session.status === 'connected';
};

const ensureWhatsappSessionReady = async (safeApiUrl: string) => {
  const sessionUrl = getWhatsappSessionUrl(safeApiUrl);

  const readSession = async () => {
    const response = await axios.get<WhatsappSessionStatus>(sessionUrl, {
      timeout: WHATSAPP_TIMEOUT_MS
    });
    return response.data;
  };

  const initSession = async () => {
    const response = await axios.post<WhatsappSessionStatus>(
      sessionUrl,
      {},
      {
        timeout: WHATSAPP_TIMEOUT_MS
      }
    );
    return response.data;
  };

  const currentSession = await readSession();
  if (isWhatsappSessionReady(currentSession)) {
    return;
  }

  const initializedSession = await initSession();
  if (isWhatsappSessionReady(initializedSession)) {
    return;
  }

  await wait(WHATSAPP_SESSION_RETRY_DELAY_MS);

  const refreshedSession = await readSession();
  if (isWhatsappSessionReady(refreshedSession)) {
    return;
  }

  throw new Error(`WhatsApp session "${WHATSAPP_SESSION_ID}" is not ready`);
};

const sendWhatsappOtp = async (to: string, otp: string) => {
  const safeApiUrl = WA_API_URL?.replace(/\/$/, '');

  if (!safeApiUrl) {
    throw new Error('WHATSAPP_API_URL is not configured');
  }

  try {
    await ensureWhatsappSessionReady(safeApiUrl);
  } catch (sessionError) {
    console.warn('WhatsApp session preflight warning:', sessionError);
  }

  await axios.post(
    `${safeApiUrl}/messages/send`,
    {
      sessionId: WHATSAPP_SESSION_ID,
      to,
      text: `Your Atap.solar verification code is: ${otp}`
    },
    {
      timeout: WHATSAPP_TIMEOUT_MS
    }
  );
};

const respondWhatsappError = (res: Response, error: unknown) => {
  if (error instanceof Error && /WhatsApp session ".+" is not ready/i.test(error.message)) {
    res.status(503).json({ error: error.message });
    return;
  }

  if (axios.isAxiosError(error)) {
    const responseError =
      typeof error.response?.data === 'object' && error.response?.data && 'error' in error.response.data
        ? String(error.response.data.error)
        : undefined;

    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'WhatsApp service timed out. Please try again.' });
      return;
    }

    if (responseError && /session|connected|socket/i.test(responseError)) {
      res.status(503).json({ error: `WhatsApp session "${WHATSAPP_SESSION_ID}" is not ready. Please reconnect it and try again.` });
      return;
    }

    res.status(503).json({ error: 'Failed to send OTP via WhatsApp' });
    return;
  }

  res.status(503).json({ error: 'Failed to send OTP via WhatsApp' });
};

const resolveAuthMode = async (returnTo?: string) => {
  const isReferralAuth = await isReferralAuthReturnTo(returnTo);
  return {
    isReferralAuth,
    mode: isReferralAuth ? 'referral' : 'employee'
  };
};


export const getAuthContext = async (req: Request, res: Response): Promise<void> => {
  try {
    const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
    const authContext = await resolveAuthMode(returnTo);

    res.json({
      mode: authContext.mode,
      isReferralAuth: authContext.isReferralAuth,
      loginTitle: authContext.isReferralAuth ? 'ETERNALGY REFERRAL LOGIN' : 'ETERNALGY SDN BHD',
      pageTitle: authContext.isReferralAuth ? 'Referral Login - ETERNALGY' : 'Login - ETERNALGY SDN BHD'
    });
  } catch (error) {
    console.error('Get Auth Context Error:', error);
    res.status(500).json({ error: 'Failed to determine auth mode' });
  }
};

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, countryCode, localPhoneNumber, returnTo } = req.body;
    const authContext = await resolveAuthMode(returnTo);

    if (authContext.isReferralAuth) {
      const localPhone = sanitizePhone(localPhoneNumber || phoneNumber || '');
      if (!localPhone) {
        res.status(400).json({ error: 'Mobile number is required' });
        return;
    }

      const cleanCountryCode = normalizeCountryCode(countryCode);
      const fullPhoneNumber = buildInternationalPhone(cleanCountryCode, localPhone);
      let referralResult = await findReferralByMobile(cleanCountryCode, localPhone);

      if (referralResult.rows.length === 0) {
        const createdReferral = await createReferralProfile(cleanCountryCode, localPhone);
        referralResult = { ...referralResult, rows: [createdReferral] } as typeof referralResult;
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      await query(
        `INSERT INTO auth_hub_otps (phone_number, code, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
         ON CONFLICT (phone_number)
         DO UPDATE SET code = $2, expires_at = NOW() + INTERVAL '5 minutes'`,
        [fullPhoneNumber, otp]
      );

      try {
        await sendWhatsappOtp(fullPhoneNumber, otp);
      } catch (apiError) {
        console.error('WhatsApp API Error:', apiError);
        respondWhatsappError(res, apiError);
        return;
      }

      res.json({ message: 'OTP sent', mode: 'referral' });
      return;
    }

    const submittedPhone = phoneNumber || localPhoneNumber;
    if (!submittedPhone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const cleanPhone = sanitizePhone(submittedPhone);
    const employeeAuth = await analyzeEmployeeAuthAttempt(cleanPhone);

    if (!employeeAuth.ok) {
      res.status(employeeAuth.status).json(employeeAuth.payload);
      return;
    }

    const { localPhone } = employeeAuth;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await query(
      `INSERT INTO auth_hub_otps (phone_number, code, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
       ON CONFLICT (phone_number)
       DO UPDATE SET code = $2, expires_at = NOW() + INTERVAL '5 minutes'`,
      [cleanPhone, otp]
    );

    const isSingapore = cleanPhone.startsWith('65');
    const waTarget = isSingapore ? cleanPhone : '60' + localPhone.substring(1);

    try {
      await sendWhatsappOtp(waTarget, otp);
    } catch (apiError) {
      console.error('WhatsApp API Error:', apiError);
      respondWhatsappError(res, apiError);
      return;
    }

    res.json({ message: 'OTP sent', mode: 'employee' });
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, code, countryCode, localPhoneNumber, returnTo } = req.body;
    const authContext = await resolveAuthMode(returnTo);

    if (authContext.isReferralAuth) {
      const localPhone = sanitizePhone(localPhoneNumber || phoneNumber || '');
      const cleanCountryCode = normalizeCountryCode(countryCode);
      const fullPhoneNumber = buildInternationalPhone(cleanCountryCode, localPhone);
      const normalizedLocalPhone = normalizeReferralLocalPhone(cleanCountryCode, localPhone);

      const otpResult = await query(
        `SELECT * FROM auth_hub_otps WHERE phone_number = $1 AND code = $2 AND expires_at > NOW()`,
        [fullPhoneNumber, code]
      );

      if (otpResult.rows.length === 0) {
        res.status(400).json({ error: 'Invalid or expired OTP' });
        return;
      }

      const referralResult = await findReferralByMobile(cleanCountryCode, localPhone);
      if (referralResult.rows.length === 0) {
        res.status(403).json({ error: 'Referral profile not found' });
        return;
      }

      const referral = referralResult.rows[0];
      const token = jwt.sign(
        {
          referralId: referral.id,
          referralBubbleId: referral.bubble_id,
          phone: normalizedLocalPhone,
          fullPhone: fullPhoneNumber,
          role: 'referral',
          isAdmin: false,
          name: referral.name,
          authMode: 'referral'
        },
        JWT_SECRET,
        { expiresIn: '14d' }
      );

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        domain: COOKIE_DOMAIN,
        path: '/',
        maxAge: 14 * 24 * 60 * 60 * 1000
      });

      await query('DELETE FROM auth_hub_otps WHERE phone_number = $1', [fullPhoneNumber]);

      res.json({
        success: true,
        user: {
          id: referral.id,
          name: referral.name,
          phone: normalizedLocalPhone,
          role: 'referral',
          authMode: 'referral'
        }
      });
      return;
    }

    const cleanPhone = sanitizePhone(phoneNumber || localPhoneNumber || '');
    const employeeAuth = await analyzeEmployeeAuthAttempt(cleanPhone);

    if (!employeeAuth.ok) {
      res.status(employeeAuth.status).json(employeeAuth.payload);
      return;
    }

    const { user, localPhone } = employeeAuth;

    const otpResult = await query(
      `SELECT * FROM auth_hub_otps WHERE phone_number = $1 AND code = $2 AND expires_at > NOW()`,
      [cleanPhone, code]
    );

    if (otpResult.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired OTP' });
      return;
    }

    let isAdmin = false;
    if (Array.isArray(user.access_level)) {
      if (user.access_level.includes('admin') || user.access_level.includes('superadmin')) {
        isAdmin = true;
      }
    }

    const token = jwt.sign(
      {
        userId: user.id,
        phone: localPhone,
        role: 'user',
        isAdmin,
        name: user.name,
        authMode: 'employee'
      },
      JWT_SECRET,
      { expiresIn: '14d' }
    );

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: COOKIE_DOMAIN,
      path: '/',
      maxAge: 14 * 24 * 60 * 60 * 1000
    });

    await query('DELETE FROM auth_hub_otps WHERE phone_number = $1', [cleanPhone]);

    res.json({ success: true, user: { id: user.id, name: user.name, phone: localPhone, isAdmin, authMode: 'employee' } });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const me = (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user });
};

export const logout = (req: Request, res: Response) => {
  res.clearCookie('auth_token', {
    domain: COOKIE_DOMAIN,
    path: '/'
  });
  res.json({ message: 'Logged out' });
};

export const lookupMobileByEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const result = await lookupRegisteredMobilesByEmail(email);

    if (!result.ok) {
      res.status(result.status).json(result.payload);
      return;
    }

    res.json(result.payload);
  } catch (error) {
    console.error('Lookup Mobile By Email Error:', error);
    res.status(500).json({
      error: 'Failed to look up registered mobile number.',
      code: 'EMAIL_LOOKUP_FAILED',
      title: 'Lookup Failed',
      detail: 'We could not complete the email lookup right now. Please try again shortly.'
    });
  }
};
