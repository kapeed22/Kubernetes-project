const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Database Connection (Uses K8s Service Name 'db-service')
const db = new Pool({
  host: process.env.DB_HOST || 'db-service',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgrespass',
  database: process.env.DB_NAME || 'authdb',
  port: 5432,
});

// Redis Connection (Uses K8s Service Name 'redis-service')
const redisClient = redis.createClient({
  url: `redis://${process.env.REDIS_HOST || 'redis-service'}:6379`
});
redisClient.connect().catch(console.error);

// Init DB Table
db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
  )
`).catch(console.error);

// 1. REGISTER API
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Username already exists or invalid data' });
  }
});

// 2. LOGIN API (Stores Session ID in Redis)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Generate Session ID and cache in Redis for 1 Hour (3600 seconds)
    const sessionId = crypto.randomUUID();
    await redisClient.setEx(`session:${sessionId}`, 3600, JSON.stringify({ userId: user.id, username: user.username }));

    res.json({ message: 'Logged in successfully', sessionId, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. ME / SESSION VERIFY API (Checks Redis First!)
app.get('/api/me', async (req, res) => {
  const sessionId = req.headers['authorization'];
  if (!sessionId) return res.status(401).json({ error: 'No session provided' });

  try {
    // REDIS LOOKUP
    const cachedUser = await redisClient.get(`session:${sessionId}`);
    if (cachedUser) {
      console.log('Session cache HIT in Redis!');
      return res.json({ source: 'Redis Cache', user: JSON.parse(cachedUser) });
    }

    console.log('Session cache MISS in Redis');
    return res.status(401).json({ error: 'Session expired or invalid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log('Backend listening on port 5000'));
