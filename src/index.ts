import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import { logger } from './middleware/authMiddleware';
import { assertDatabaseConnection, query } from './db';
import { getHealthSummary, getLiveness, isReady } from './health';
import { ensureReferralAuthSchema } from './utils/referralAuth';

dotenv.config();

import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

// Dynamic CORS Configuration
// We cache allowed origins for 10 seconds to reduce DB hits
let allowedOriginsCache: string[] = [];
let lastCacheUpdate = 0;

const getAllowedOrigins = async (): Promise<string[]> => {
    const now = Date.now();
    if (now - lastCacheUpdate < 10000 && allowedOriginsCache.length > 0) {
        return allowedOriginsCache;
    }
    try {
        const result = await query('SELECT origin FROM auth_hub_cors_origins');
        allowedOriginsCache = result.rows.map((r: any) => r.origin);
        lastCacheUpdate = now;
        return allowedOriginsCache;
    } catch (err) {
        console.error('Failed to load CORS origins:', err);
        return [];
    }
};

const corsOptions: cors.CorsOptions = {
    origin: async (requestOrigin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!requestOrigin) return callback(null, true);

        const allowed = await getAllowedOrigins();
        if (allowed.includes(requestOrigin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(logger);

// Serve Static Files (Before CORS to ensure assets load)
app.use(express.static(path.join(__dirname, '../public')));

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);

app.get('/health/live', (req, res) => {
    res.json(getLiveness());
});

app.get('/health/ready', async (req, res) => {
    const summary = await getHealthSummary();
    res.status(isReady(summary) ? 200 : 503).json(summary);
});

app.get('/health', async (req, res) => {
    const summary = await getHealthSummary();
    res.status(summary.status === 'fail' ? 503 : 200).json(summary);
});

// Documentation
app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/docs.html'));
});

// Fallback to login page for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Start Server
const startServer = async () => {
    await assertDatabaseConnection();
    await ensureReferralAuthSchema();
    app.listen(PORT, () => {
        console.log(`Auth Service running on port ${PORT}`);
    });
};

startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
