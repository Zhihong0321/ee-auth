import { Request, Response } from 'express';
import { query } from '../db';
import path from 'path';

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