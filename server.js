// Load environment variables ONLY in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { query, initializeDatabase } = require('./database.js');

const app = express();
const PORT = process.env.PORT || 3000;

// REQUIRED for Render / proxies
app.set('trust proxy', 1);

// ========== MIDDLEWARE ==========
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
});
app.use('/api/', limiter);

// Static files
app.use(express.static('public'));

// ========== ROUTES ==========

// Health check (NO TABLE QUERIES)
app.get('/health', async (req, res) => {
    try {
        await query('SELECT 1');
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Get signup count
app.get('/api/count', async (req, res) => {
    try {
        const result = await query(
            'SELECT COUNT(*)::int AS count FROM public.waitlist_users'
        );
        res.json({ success: true, count: result.rows[0].count });
    } catch (error) {
        console.error('❌ Count error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to get count' });
    }
});

// Signup
app.post('/api/signup', async (req, res) => {
    const { name, email, phone } = req.body;
    const gender = req.body.gender || 'prefer-not-to-say';
    const age = req.body.age || 'not-specified';

    if (!name || !email || !phone) {
        return res.status(400).json({ success: false, error: 'Missing fields' });
    }

    try {
        const existing = await query(
            'SELECT id FROM public.waitlist_users WHERE email = $1',
            [email]
        );

        if (existing.rows.length) {
            return res.status(409).json({ success: false, error: 'Email already registered' });
        }

        const ip =
            req.headers['x-forwarded-for']?.split(',')[0] || req.ip;

        const result = await query(
            `INSERT INTO public.waitlist_users
            (name, email, phone, gender, age, ip_address, user_agent)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id`,
            [name, email, phone, gender, age, ip, req.get('User-Agent')]
        );

        await query(
            `UPDATE public.waitlist_analytics
             SET total_signups = total_signups + 1,
                 last_updated = NOW()`
        );

        res.json({ success: true, userId: result.rows[0].id });

    } catch (error) {
        console.error('❌ Signup error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Admin (dev only)
app.get('/api/signups', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        const result = await query(
            `SELECT id, name, email, phone, gender, age, created_at
             FROM public.waitlist_users
             ORDER BY created_at DESC`
        );
        res.json({ success: true, data: result.rows });
    } catch {
        res.status(500).json({ success: false });
    }
});

// SPA fallback
app.get('*', (req, res) =>
    res.sendFile(__dirname + '/public/index.html')
);

// ========== START SERVER ==========
async function startServer() {
    console.log('🚀 Starting Waitlist Application...');

    // FORCE schema
    await query('SET search_path TO public');

    // CREATE TABLES FIRST
    await initializeDatabase();

    app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
    });
}

startServer().catch(err => {
    console.error('❌ Startup failure:', err);
    process.exit(1);
});
