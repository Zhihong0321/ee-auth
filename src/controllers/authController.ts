import { Request, Response } from 'express';
import { query } from '../db';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || '.atap.solar';
const WA_API_URL = process.env.WHATSAPP_API_URL;

// Helper to sanitize phone number (remove non-digits)
const sanitizePhone = (phone: string) => phone.replace(/\D/g, '');

// Helper: Convert various formats to local '012...' format for DB search
const toLocalFormat = (phone: string) => {
  // If it starts with 60, remove 6 and ensure it starts with 0 (6012 -> 012)
  if (phone.startsWith('60')) return '0' + phone.slice(2);
  
  // If it starts with 0, keep it (012 -> 012)
  if (phone.startsWith('0')) return phone;
  
  // If it's just the raw digits without prefix (123456789), add the 0 (-> 0123456789)
  return '0' + phone;
};

export const sendOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const cleanPhone = sanitizePhone(phoneNumber);
    const localPhone = toLocalFormat(cleanPhone);

    // 1. Check if user exists (Join User -> Agent)
    // We strictly use the Agent's contact to find the User.
    const userResult = await query(
      `SELECT u.id, a.name 
       FROM "user" u 
       JOIN agent a ON u.linked_agent_profile = a.bubble_id 
       WHERE a.contact = $1`,
      [localPhone]
    );

    if (userResult.rows.length === 0) {
       res.status(403).json({ error: 'Access Denied: Number not registered' });
       return;
    }

    // 2. Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // 3. Store OTP in Postgres (auth_hub_otps)
    await query(
        `INSERT INTO auth_hub_otps (phone_number, code, expires_at) 
         VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
         ON CONFLICT (phone_number) 
         DO UPDATE SET code = $2, expires_at = NOW() + INTERVAL '5 minutes'`,
        [cleanPhone, otp]
    );

    // 4. Send via WhatsApp API
    // Ensure we send to 601... format. 
    // localPhone is guaranteed to look like '012...' due to toLocalFormat()
    // So we just replace the leading '0' with '60'.
    const waTarget = '60' + localPhone.substring(1);

    try {
        await axios.post(`${WA_API_URL}/api/send`, {
            to: waTarget,
            message: `Your Atap.solar verification code is: ${otp}`
        });
    } catch (apiError) {
        console.error('WhatsApp API Error:', apiError);
        res.status(503).json({ error: 'Failed to send OTP via WhatsApp' });
        return;
    }

    res.json({ message: 'OTP sent' });

  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phoneNumber, code } = req.body;
    const cleanPhone = sanitizePhone(phoneNumber);
    const localPhone = toLocalFormat(cleanPhone);

    // 1. Verify OTP from Postgres
    const otpResult = await query(
      `SELECT * FROM auth_hub_otps WHERE phone_number = $1 AND code = $2 AND expires_at > NOW()`,
      [cleanPhone, code]
    );

    if (otpResult.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired OTP' });
      return;
    }

    // 2. Get User Details
    const userResult = await query(
      `SELECT u.id, u.access_level, a.name, a.contact 
       FROM "user" u 
       JOIN agent a ON u.linked_agent_profile = a.bubble_id 
       WHERE a.contact = $1`,
      [localPhone]
    );

    if (userResult.rows.length === 0) {
        res.status(403).json({ error: 'User not found' });
        return;
    }

    const user = userResult.rows[0];
    
    // Check Admin Role
    let isAdmin = false;
    if (Array.isArray(user.access_level)) {
        if (user.access_level.includes('admin') || user.access_level.includes('superadmin')) {
            isAdmin = true;
        }
    }

    // 3. Generate JWT
    const token = jwt.sign(
      { 
          userId: user.id, 
          phone: cleanPhone, 
          role: 'user', 
          isAdmin: isAdmin, 
          name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '14d' }
    );

    // 4. Set Cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      domain: COOKIE_DOMAIN,
      path: '/',
      maxAge: 14 * 24 * 60 * 60 * 1000 // 14 days
    });

    // Clean up used OTP from Postgres
    await query('DELETE FROM auth_hub_otps WHERE phone_number = $1', [cleanPhone]);

    res.json({ success: true, user: { id: user.id, name: user.name, phone: cleanPhone, isAdmin } });

  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const me = (req: Request, res: Response) => {
    // Middleware should have attached user to req
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