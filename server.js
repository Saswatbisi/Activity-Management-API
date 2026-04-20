/**
 * Activity Management API — Server Entry Point
 *
 * A scalable API with:
 * - Redis Caching (Cache-aside pattern for activity list)
 * - WebSockets (Socket.io for live "User Joined" notifications)
 * - Worker Threads (PDF ticket generation)
 * - Race Condition Handling (Redis WATCH/MULTI/EXEC optimistic locking)
 *
 * MeetMux Capstone Project — Node.js Backend Track
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

// ── Config Imports ──────────────────────────────────────────
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { initSocket } = require('./config/socket');

// ── Route Imports ───────────────────────────────────────────
const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const registrationRoutes = require('./routes/registrations');

// ── Initialize Express ──────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static Files (for ticket PDFs) ──────────────────────────
app.use('/tickets', express.static(path.join(__dirname, 'tickets')));

// ── Health Check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: '🚀 Activity Management API is running!',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      activities: '/api/activities',
      registrations: '/api/activities/:id/register',
    },
    features: [
      'Redis Caching (activity list)',
      'WebSockets (live notifications)',
      'Worker Threads (PDF ticket generation)',
      'Race Condition Handling (optimistic locking)',
    ],
  });
});

// ── Mount Routes ────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/activities', registrationRoutes);

// ── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.url} not found.`,
  });
});

// ── Global Error Handler ────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ── Start Server ────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Connect to Redis
    await connectRedis();

    // 3. Initialize Socket.io
    initSocket(server);

    // 4. Start HTTP Server
    server.listen(PORT, () => {
      console.log(`\n${'═'.repeat(55)}`);
      console.log(`🚀 Activity Management API`);
      console.log(`${'─'.repeat(55)}`);
      console.log(`   Server:     http://localhost:${PORT}`);
      console.log(`   MongoDB:    ${process.env.MONGODB_URI}`);
      console.log(`   Redis:      ${process.env.REDIS_URL}`);
      console.log(`   WebSocket:  ws://localhost:${PORT}`);
      console.log(`${'═'.repeat(55)}\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// ── Graceful Shutdown ───────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed.');
    process.exit(0);
  });
});

startServer();
