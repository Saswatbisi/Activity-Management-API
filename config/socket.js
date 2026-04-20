const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

/**
 * Initialize Socket.io with JWT authentication middleware
 * @param {http.Server} httpServer - The HTTP server instance
 * @returns {Server} The Socket.io server instance
 */
const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // ── JWT Authentication Middleware ──────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      return next(new Error('Authentication error: Invalid token'));
    }
  });

  // ── Connection Handler ────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.user.name} (${socket.id})`);

    // Join an activity room to receive live updates
    socket.on('join-activity-room', (activityId) => {
      socket.join(`activity:${activityId}`);
      console.log(`📌 ${socket.user.name} joined room activity:${activityId}`);
    });

    // Leave an activity room
    socket.on('leave-activity-room', (activityId) => {
      socket.leave(`activity:${activityId}`);
      console.log(`📌 ${socket.user.name} left room activity:${activityId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.user.name} (${socket.id})`);
    });
  });

  console.log('✅ Socket.io Initialized');
  return io;
};

/**
 * Get the Socket.io instance
 * @returns {Server}
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized. Call initSocket() first.');
  }
  return io;
};

module.exports = { initSocket, getIO };
