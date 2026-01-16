const { Pool } = require('pg');

// Load env vars only in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Determine connection string
const connectionString = process.env.DATABASE_URL;

// Safety check
if (!connectionString) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
}

// Create PostgreSQL connection pool
const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Generic query helper
const query = (text, params) => pool.query(text, params);

// Test database connection
const testConnection = async () => {
    try {
        const client = await pool.connect();
        console.log('✅ PostgreSQL connected successfully');

        const result = await client.query(`
            SELECT 
                (SELECT COUNT(*) FROM waitlist_users) AS user_count,
                (SELECT COUNT(*) FROM waitlist_analytics) AS analytics_count
        `);

        console.log('📊 Database stats:', {
            users: result.rows[0].user_count,
            analytics: result.rows[0].analytics_count
        });

        client.release();
        return true;
    } catch (error) {
        console.error('❌ PostgreSQL connection failed:', error.message);
        return false;
    }
};

// Initialize database (safe for Render)
const initializeDatabase = async () => {
    try {
        console.log('🔍 Verifying database tables...');

        await query('SELECT 1 FROM waitlist_users LIMIT 1');
        await query('SELECT 1 FROM waitlist_analytics LIMIT 1');

        console.log('✅ Database tables verified');
        return true;

    } catch (error) {
        console.log('⚠️ Tables missing. Creating...');

        try {
            await query(`
                CREATE TABLE IF NOT EXISTS waitlist_users (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    phone VARCHAR(50) NOT NULL,
                    gender VARCHAR(50),
                    age VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ip_address VARCHAR(50),
                    user_agent TEXT,
                    referral_code VARCHAR(50)
                );
            `);

            await query(`
                CREATE INDEX IF NOT EXISTS idx_waitlist_email 
                ON waitlist_users(email);
            `);

            await query(`
                CREATE INDEX IF NOT EXISTS idx_waitlist_created_at 
                ON waitlist_users(created_at);
            `);

            await query(`
                CREATE TABLE IF NOT EXISTS waitlist_analytics (
                    id SERIAL PRIMARY KEY,
                    total_signups INT DEFAULT 0,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Ensure analytics row exists
            const result = await query('SELECT COUNT(*) FROM waitlist_analytics');
            if (parseInt(result.rows[0].count) === 0) {
                await query(
                    'INSERT INTO waitlist_analytics (total_signups) VALUES (0)'
                );
            }

            console.log('✅ Database initialized successfully');
            return true;

        } catch (createError) {
            console.error('❌ Failed to initialize database:', createError.message);
            return false;
        }
    }
};

module.exports = {
    query,
    testConnection,
    initializeDatabase
};
