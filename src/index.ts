import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import { logger } from './middleware/authMiddleware';
import { query } from './db';

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

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
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
app.listen(PORT, () => {
    console.log(`Auth Service running on port ${PORT}`);
});
