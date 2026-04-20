const express = require('express');
const auth = require('../middleware/auth');
const Activity = require('../models/Activity');
const { getCache, setCache, deleteCache } = require('../config/redis');

const router = express.Router();

const CACHE_KEY = 'activities:all';
const CACHE_TTL = 60; // 60 seconds

// ── GET /api/activities ─────────────────────────────────────
// List all activities (with Redis caching)
router.get('/', async (req, res) => {
  try {
    // 1. Check Redis cache first
    const cachedData = await getCache(CACHE_KEY);
    if (cachedData) {
      console.log('📦 Cache HIT — Returning cached activities');
      return res.status(200).json({
        success: true,
        source: 'cache',
        count: cachedData.length,
        data: cachedData,
      });
    }

    // 2. Cache MISS — Query MongoDB
    console.log('🔍 Cache MISS — Querying MongoDB');
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const activities = await Activity.find()
      .populate('createdBy', 'name email')
      .sort({ date: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Activity.countDocuments();

    const responseData = {
      activities,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalActivities: total,
      },
    };

    // 3. Store in Redis with TTL
    await setCache(CACHE_KEY, responseData, CACHE_TTL);

    res.status(200).json({
      success: true,
      source: 'database',
      count: activities.length,
      data: responseData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching activities.',
      error: error.message,
    });
  }
});

// ── GET /api/activities/:id ─────────────────────────────────
// Get a single activity by ID
router.get('/:id', async (req, res) => {
  try {
    // Check individual cache
    const cacheKey = `activity:${req.params.id}`;
    const cachedActivity = await getCache(cacheKey);
    if (cachedActivity) {
      return res.status(200).json({
        success: true,
        source: 'cache',
        data: cachedActivity,
      });
    }

    const activity = await Activity.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('participants', 'name email');

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.',
      });
    }

    // Cache for 30 seconds
    await setCache(cacheKey, activity, 30);

    res.status(200).json({
      success: true,
      source: 'database',
      data: activity,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching activity.',
      error: error.message,
    });
  }
});

// ── POST /api/activities ────────────────────────────────────
// Create a new activity (auth required)
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, date, location, maxParticipants } = req.body;

    // Validate required fields
    if (!title || !description || !date || !location || !maxParticipants) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title, description, date, location, and maxParticipants.',
      });
    }

    const activity = await Activity.create({
      title,
      description,
      date,
      location,
      maxParticipants,
      createdBy: req.user._id,
    });

    // Invalidate the activities list cache
    await deleteCache(CACHE_KEY);

    res.status(201).json({
      success: true,
      message: 'Activity created successfully.',
      data: activity,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating activity.',
      error: error.message,
    });
  }
});

// ── PUT /api/activities/:id ─────────────────────────────────
// Update an activity (auth required, owner only)
router.put('/:id', auth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.',
      });
    }

    // Check ownership
    if (activity.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only update activities you created.',
      });
    }

    const updatedActivity = await Activity.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    // Invalidate caches
    await deleteCache(CACHE_KEY);
    await deleteCache(`activity:${req.params.id}`);

    res.status(200).json({
      success: true,
      message: 'Activity updated successfully.',
      data: updatedActivity,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating activity.',
      error: error.message,
    });
  }
});

// ── DELETE /api/activities/:id ──────────────────────────────
// Delete an activity (auth required, owner only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.',
      });
    }

    // Check ownership
    if (activity.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete activities you created.',
      });
    }

    await Activity.findByIdAndDelete(req.params.id);

    // Invalidate caches
    await deleteCache(CACHE_KEY);
    await deleteCache(`activity:${req.params.id}`);

    res.status(200).json({
      success: true,
      message: 'Activity deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting activity.',
      error: error.message,
    });
  }
});

module.exports = router;
