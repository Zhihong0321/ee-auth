import { Request, Response } from 'express';
import { query } from '../db';
import path from 'path';
import { getReferralAuthUrls } from '../utils/referralAuth';

// Serve Admin Dashboard HTML
export const renderDashboard = (req: Request, res: Response) => {
    // Basic verification is handled by middleware
    res.sendFile(path.join(__dirname, '../../public/admin.html'));
};

// Get List of Allowed Origins
export const getOrigins = async (req: Request, res: Response) => {
    try {
        const result = await query('SELECT origin FROM auth_hub_cors_origins ORDER BY created_at DESC');
        res.json({ origins: result.rows.map(r => r.origin) });
    } catch (error) {
        console.error('Get Origins Error:', error);
        res.status(500).json({ error: 'Failed to fetch origins' });
    }
};

export const getReferralAuthUrlsController = async (req: Request, res: Response) => {
    try {
        const urls = await getReferralAuthUrls();
        res.json({ urls });
    } catch (error) {
        console.error('Get Referral Auth URLs Error:', error);
        res.status(500).json({ error: 'Failed to fetch referral auth URLs' });
    }
};

// Add Allowed Origin
export const addOrigin = async (req: Request, res: Response) => {
    try {
        const { origin } = req.body;
        if (!origin || !origin.startsWith('http')) {
            res.status(400).json({ error: 'Valid URL origin required (e.g. https://example.com)' });
            return;
        }

        // Postgres INSERT ON CONFLICT
        await query(
            'INSERT INTO auth_hub_cors_origins (origin, created_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING',
            [origin.trim()]
        );
        res.json({ message: 'Origin added' });
    } catch (error) {
        console.error('Add Origin Error:', error);
        res.status(500).json({ error: 'Failed to add origin' });
    }
};

export const addReferralAuthUrl = async (req: Request, res: Response) => {
    try {
        const { url } = req.body;
        if (!url || !url.startsWith('http')) {
            res.status(400).json({ error: 'Valid return URL required (e.g. https://example.com/path)' });
            return;
        }

        await query(
            'INSERT INTO auth_hub_referral_auth_urls (url, created_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING',
            [url.trim().replace(/\/+$/, '')]
        );
        res.json({ message: 'Referral auth URL added' });
    } catch (error) {
        console.error('Add Referral Auth URL Error:', error);
        res.status(500).json({ error: 'Failed to add referral auth URL' });
    }
};

// Remove Allowed Origin
export const removeOrigin = async (req: Request, res: Response) => {
    try {
        const { origin } = req.body;
        if (!origin) {
            res.status(400).json({ error: 'Origin required' });
            return;
        }

        await query('DELETE FROM auth_hub_cors_origins WHERE origin = $1', [origin]);
        res.json({ message: 'Origin removed' });
    } catch (error) {
        console.error('Remove Origin Error:', error);
        res.status(500).json({ error: 'Failed to remove origin' });
    }
};

export const removeReferralAuthUrl = async (req: Request, res: Response) => {
    try {
        const { url } = req.body;
        if (!url) {
            res.status(400).json({ error: 'URL required' });
            return;
        }

        await query('DELETE FROM auth_hub_referral_auth_urls WHERE url = $1', [url.trim().replace(/\/+$/, '')]);
        res.json({ message: 'Referral auth URL removed' });
    } catch (error) {
        console.error('Remove Referral Auth URL Error:', error);
        res.status(500).json({ error: 'Failed to remove referral auth URL' });
    }
};
