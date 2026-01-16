// Load environment variables ONLY in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { query, initializeDatabase, testConnection } = require('./database.js');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (REQUIRED for Render / reverse proxies)
app.set('trust proxy', 1);

// ========== MIDDLEWARE SETUP ==========
app.use(helmet({
    contentSecurityPolicy: false
}));

app.use(cors());
app.use(express.json());

// Rate limiting (API only)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// Serve static files
app.use(express.static('public'));

// ========== ROUTES ==========

// Health check endpoint (Render-friendly)
app.get('/health', async (req, res) => {
    try {
        const dbResult = await query('SELECT 1 as test');
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbResult.rows[0].test === 1 ? 'connected' : 'error'
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Get total signup count
app.get('/api/count', async (req, res) => {
    try {
        const result = await query('SELECT COUNT(*) as count FROM waitlist_users');
        res.json({
            success: true,
            count: parseInt(result.rows[0].count)
        });
    } catch (error) {
        console.error('Error getting count:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get count'
        });
    }
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {

    if (process.env.NODE_ENV !== 'production') {
        console.log('📦 Request body:', req.body);
    }

    const { name, email, phone } = req.body;
    const gender = req.body.gender || 'prefer-not-to-say';
    const age = req.body.age || 'not-specified';

    if (!name || !email || !phone) {
        return res.status(400).json({
            success: false,
            error: 'Name, email, and phone are required'
        });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid email format'
        });
    }

    try {
        const existingUser = await query(
            'SELECT id FROM waitlist_users WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'This email is already registered'
            });
        }

        const ipAddress =
            req.headers['x-forwarded-for']?.split(',')[0] || req.ip;

        const result = await query(
            `INSERT INTO waitlist_users
             (name, email, phone, gender, age, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, created_at`,
            [
                name,
                email,
                phone,
                gender,
                age,
                ipAddress,
                req.get('User-Agent') || 'unknown'
            ]
        );

        await query(
            'UPDATE waitlist_analytics SET total_signups = total_signups + 1, last_updated = NOW()'
        );

        res.json({
            success: true,
            message: 'Successfully added to waitlist!',
            userId: result.rows[0].id
        });

    } catch (error) {
        console.error('Database error:', error);

        if (error.code === '23505') {
            return res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Server error. Please try again later.'
        });
    }
});

// Admin endpoint (DISABLED in production)
app.get('/api/signups', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        const result = await query(
            'SELECT id, name, email, phone, gender, age, created_at FROM waitlist_users ORDER BY created_at DESC LIMIT 100'
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to fetch signups'
        });
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// ========== START SERVER ==========
async function startServer() {
    console.log('🚀 Starting Waitlist Application...');

    // Wait for database (Render-safe)
    let retries = 5;
    while (retries > 0) {
        const connected = await testConnection();
        if (connected) break;

        retries--;
        console.log(`⏳ Waiting for database... retries left: ${retries}`);
        await new Promise(res => setTimeout(res, 5000));
    }

    if (retries === 0) {
        console.error('❌ Database unavailable. Exiting.');
        process.exit(1);
    }

    await initializeDatabase();

    app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Server shutting down...');
    process.exit(0);
});

// Boot
startServer().catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
});
