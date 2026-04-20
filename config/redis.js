const { createClient } = require('redis');

let client;
let useMemoryFallback = false;

// ── In-Memory Fallback Cache ────────────────────────────────
// Used when Redis is not available (still demonstrates caching patterns)
const memoryCache = new Map();
const memoryCacheTTL = new Map();

/**
 * Initialize and connect Redis client
 * Falls back to in-memory cache if Redis is unavailable
 */
const connectRedis = async () => {
  try {
    client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            console.log('⚠️  Redis max retries reached. Using in-memory fallback.');
            useMemoryFallback = true;
            return false; // Stop retrying
          }
          return Math.min(retries * 500, 3000);
        },
      },
    });

    client.on('error', (err) => {
      if (!useMemoryFallback) {
        console.error('❌ Redis Client Error:', err.message);
      }
    });

    client.on('connect', () => {
      console.log('✅ Redis Connected');
      useMemoryFallback = false;
    });

    client.on('reconnecting', () => {
      console.log('🔄 Redis Reconnecting...');
    });

    await client.connect();
    return client;
  } catch (error) {
    console.warn('⚠️  Redis unavailable — Using in-memory cache fallback');
    console.warn(`   Reason: ${error.message}`);
    useMemoryFallback = true;
    return null;
  }
};

/**
 * Get the Redis client instance
 * Returns null if using memory fallback
 */
const getRedisClient = () => {
  if (useMemoryFallback) return null;
  if (!client) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return client;
};

/**
 * Check if Redis is available
 */
const isRedisAvailable = () => !useMemoryFallback && client && client.isOpen;

/**
 * Get cached data by key
 * @param {string} key - Redis key
 * @returns {object|null} Parsed JSON data or null
 */
const getCache = async (key) => {
  try {
    if (useMemoryFallback) {
      // Check TTL expiry for in-memory cache
      const expiry = memoryCacheTTL.get(key);
      if (expiry && Date.now() > expiry) {
        memoryCache.delete(key);
        memoryCacheTTL.delete(key);
        return null;
      }
      return memoryCache.get(key) || null;
    }
    const data = await client.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error(`Cache GET error for key "${key}":`, error.message);
    return null;
  }
};

/**
 * Set cache data with a TTL
 * @param {string} key - Redis key
 * @param {object} data - Data to cache
 * @param {number} ttl - Time to live in seconds (default 60)
 */
const setCache = async (key, data, ttl = 60) => {
  try {
    if (useMemoryFallback) {
      memoryCache.set(key, data);
      memoryCacheTTL.set(key, Date.now() + ttl * 1000);
      return;
    }
    await client.set(key, JSON.stringify(data), { EX: ttl });
  } catch (error) {
    console.error(`Cache SET error for key "${key}":`, error.message);
  }
};

/**
 * Delete a cache key (for invalidation)
 * @param {string} key - Redis key to delete
 */
const deleteCache = async (key) => {
  try {
    if (useMemoryFallback) {
      memoryCache.delete(key);
      memoryCacheTTL.delete(key);
      return;
    }
    await client.del(key);
  } catch (error) {
    console.error(`Cache DEL error for key "${key}":`, error.message);
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  isRedisAvailable,
  getCache,
  setCache,
  deleteCache,
};
