const express = require('express');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const auth = require('../middleware/auth');
const Activity = require('../models/Activity');
const { getRedisClient, isRedisAvailable, deleteCache } = require('../config/redis');
const { getIO } = require('../config/socket');

const router = express.Router();

// ── Ensure tickets directory exists ─────────────────────────
const ticketsDir = path.join(__dirname, '..', 'tickets');
if (!fs.existsSync(ticketsDir)) {
  fs.mkdirSync(ticketsDir, { recursive: true });
}

/**
 * Race-Condition-Safe Registration
 *
 * Strategy A (Redis available): WATCH/MULTI/EXEC optimistic locking
 *   1. WATCH the Redis key `activity:{id}:seats`
 *   2. GET current seat count
 *   3. If seats >= maxParticipants → reject (FULL)
 *   4. MULTI → INCR seats → EXEC
 *   5. If EXEC returns null → conflict detected → RETRY
 *   6. If EXEC succeeds → update MongoDB → emit WebSocket event
 *
 * Strategy B (Redis fallback): MongoDB atomic findOneAndUpdate with conditions
 *   Uses $where / conditions to atomically check & update in one query
 */

// ── POST /api/activities/:id/register ───────────────────────
// Register for an activity (race-condition safe)
router.post('/:id/register', auth, async (req, res) => {
  const activityId = req.params.id;
  const userId = req.user._id.toString();

  try {
    // 1. Fetch the activity from MongoDB to get maxParticipants
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.',
      });
    }

    // 2. Check if user is already registered
    if (activity.participants.map((p) => p.toString()).includes(userId)) {
      return res.status(409).json({
        success: false,
        message: 'You are already registered for this activity.',
      });
    }

    let updatedActivity;

    // ── Strategy A: Redis WATCH/MULTI/EXEC ──────────────────
    if (isRedisAvailable()) {
      const redisClient = getRedisClient();
      const seatsKey = `activity:${activityId}:seats`;
      const maxRetriesOnConflict = 5;

      // Initialize the Redis seat counter if it doesn't exist
      const existingSeats = await redisClient.get(seatsKey);
      if (existingSeats === null) {
        await redisClient.set(seatsKey, activity.currentParticipants.toString());
      }

      // Optimistic Locking Loop
      let registered = false;
      let attempt = 0;

      while (!registered && attempt < maxRetriesOnConflict) {
        attempt++;

        try {
          // WATCH the seats key
          await redisClient.watch(seatsKey);

          // GET current seat count
          const currentSeats = parseInt(await redisClient.get(seatsKey), 10);

          // Check if activity is full
          if (currentSeats >= activity.maxParticipants) {
            await redisClient.unwatch();
            return res.status(409).json({
              success: false,
              message: 'Activity is full. No spots available.',
              data: {
                maxParticipants: activity.maxParticipants,
                currentParticipants: currentSeats,
                availableSpots: 0,
              },
            });
          }

          // MULTI/EXEC — atomically increment
          const multi = redisClient.multi();
          multi.incr(seatsKey);
          const results = await multi.exec();

          if (results === null) {
            console.log(
              `⚠️  Race condition detected for activity ${activityId} (attempt ${attempt}/${maxRetriesOnConflict})`
            );
            continue; // Retry
          }

          registered = true;
        } catch (watchError) {
          console.error('Watch/Multi error:', watchError.message);
          continue;
        }
      }

      if (!registered) {
        return res.status(503).json({
          success: false,
          message: 'Registration failed due to high contention. Please try again.',
        });
      }

      // Update MongoDB after Redis lock succeeded
      updatedActivity = await Activity.findByIdAndUpdate(
        activityId,
        {
          $push: { participants: userId },
          $inc: { currentParticipants: 1 },
        },
        { new: true }
      ).populate('participants', 'name email');

    } else {
      // ── Strategy B: MongoDB Atomic Update (Fallback) ──────
      // Uses findOneAndUpdate with conditions to prevent race conditions
      // Only updates if currentParticipants < maxParticipants AND user not already in participants
      console.log('🔒 Using MongoDB atomic update for race-safe registration');

      updatedActivity = await Activity.findOneAndUpdate(
        {
          _id: activityId,
          participants: { $ne: userId }, // user not already registered
          $expr: { $lt: ['$currentParticipants', '$maxParticipants'] }, // spots available
        },
        {
          $push: { participants: userId },
          $inc: { currentParticipants: 1 },
        },
        { new: true }
      ).populate('participants', 'name email');

      if (!updatedActivity) {
        // Re-check to give a more specific error
        const freshActivity = await Activity.findById(activityId);
        if (freshActivity.participants.map((p) => p.toString()).includes(userId)) {
          return res.status(409).json({
            success: false,
            message: 'You are already registered for this activity.',
          });
        }
        return res.status(409).json({
          success: false,
          message: 'Activity is full. No spots available.',
          data: {
            maxParticipants: freshActivity.maxParticipants,
            currentParticipants: freshActivity.currentParticipants,
            availableSpots: 0,
          },
        });
      }
    }

    // 3. Invalidate activity caches
    await deleteCache('activities:all');
    await deleteCache(`activity:${activityId}`);

    // 4. Emit WebSocket "user-joined" event
    try {
      const io = getIO();
      io.to(`activity:${activityId}`).emit('user-joined', {
        activityId,
        user: { name: req.user.name, email: req.user.email },
        currentParticipants: updatedActivity.currentParticipants,
        availableSpots:
          updatedActivity.maxParticipants - updatedActivity.currentParticipants,
        timestamp: new Date().toISOString(),
      });

      // If activity is now full, emit "activity-full" event
      if (
        updatedActivity.currentParticipants >= updatedActivity.maxParticipants
      ) {
        io.to(`activity:${activityId}`).emit('activity-full', {
          activityId,
          title: updatedActivity.title,
          message: 'This activity is now fully booked!',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (socketError) {
      console.error('WebSocket emit error:', socketError.message);
      // Non-critical — don't fail the registration
    }

    // 5. Trigger PDF ticket generation via Worker Thread
    const ticketData = {
      ticketId: `${activityId}-${userId}`,
      activityTitle: updatedActivity.title,
      activityDate: updatedActivity.date,
      activityLocation: updatedActivity.location,
      userName: req.user.name,
      userEmail: req.user.email,
      registeredAt: new Date().toISOString(),
    };

    // Spawn worker thread (non-blocking)
    generateTicketAsync(ticketData);

    res.status(200).json({
      success: true,
      message: 'Successfully registered for the activity!',
      data: {
        activity: updatedActivity,
        ticketUrl: `/api/activities/${activityId}/ticket`,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error during registration.',
      error: error.message,
    });
  }
});

// ── DELETE /api/activities/:id/unregister ────────────────────
// Cancel registration for an activity
router.delete('/:id/unregister', auth, async (req, res) => {
  const activityId = req.params.id;
  const userId = req.user._id.toString();

  try {
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.',
      });
    }

    // Check if user is actually registered
    if (!activity.participants.map((p) => p.toString()).includes(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are not registered for this activity.',
      });
    }

    // Update MongoDB — remove user from participants
    const updatedActivity = await Activity.findByIdAndUpdate(
      activityId,
      {
        $pull: { participants: userId },
        $inc: { currentParticipants: -1 },
      },
      { new: true }
    );

    // Decrement Redis seat counter if available
    if (isRedisAvailable()) {
      const redisClient = getRedisClient();
      const seatsKey = `activity:${activityId}:seats`;
      await redisClient.decr(seatsKey);
    }

    // Invalidate caches
    await deleteCache('activities:all');
    await deleteCache(`activity:${activityId}`);

    // Delete the ticket PDF if it exists
    const ticketPath = path.join(ticketsDir, `ticket-${activityId}-${userId}.pdf`);
    if (fs.existsSync(ticketPath)) {
      fs.unlinkSync(ticketPath);
    }

    res.status(200).json({
      success: true,
      message: 'Successfully unregistered from the activity.',
      data: updatedActivity,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error during unregistration.',
      error: error.message,
    });
  }
});

// ── GET /api/activities/:id/ticket ──────────────────────────
// Download PDF ticket for a registered activity
router.get('/:id/ticket', auth, async (req, res) => {
  const activityId = req.params.id;
  const userId = req.user._id.toString();
  const ticketPath = path.join(ticketsDir, `ticket-${activityId}-${userId}.pdf`);

  try {
    // Check if user is registered
    const activity = await Activity.findById(activityId);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.',
      });
    }

    if (!activity.participants.map((p) => p.toString()).includes(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not registered for this activity. No ticket available.',
      });
    }

    // Check if ticket PDF exists
    if (!fs.existsSync(ticketPath)) {
      // Trigger a regeneration
      const ticketData = {
        ticketId: `${activityId}-${userId}`,
        activityTitle: activity.title,
        activityDate: activity.date,
        activityLocation: activity.location,
        userName: req.user.name,
        userEmail: req.user.email,
        registeredAt: new Date().toISOString(),
      };

      try {
        await generateTicketSync(ticketData);
      } catch (genError) {
        return res.status(500).json({
          success: false,
          message: 'Error generating ticket. Please try again.',
        });
      }
    }

    // Send the PDF file
    res.download(ticketPath, `ticket-${activityId}.pdf`);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error downloading ticket.',
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════
// Worker Thread Helpers
// ═══════════════════════════════════════════════════════════

/**
 * Generate a PDF ticket asynchronously (fire-and-forget)
 * Uses Worker Threads to avoid blocking the main event loop
 */
function generateTicketAsync(ticketData) {
  const workerPath = path.join(__dirname, '..', 'workers', 'pdfWorker.js');

  const worker = new Worker(workerPath, { workerData: ticketData });

  worker.on('message', (result) => {
    if (result.success) {
      console.log(`🎫 Ticket generated: ${result.filePath}`);
    } else {
      console.error(`❌ Ticket generation failed: ${result.error}`);
    }
  });

  worker.on('error', (error) => {
    console.error('❌ Worker thread error:', error.message);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`❌ Worker stopped with exit code ${code}`);
    }
  });
}

/**
 * Generate a PDF ticket synchronously (waits for completion)
 * Used when the ticket needs to be available immediately (e.g., download)
 */
function generateTicketSync(ticketData) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '..', 'workers', 'pdfWorker.js');

    const worker = new Worker(workerPath, { workerData: ticketData });

    worker.on('message', (result) => {
      if (result.success) {
        resolve(result);
      } else {
        reject(new Error(result.error));
      }
    });

    worker.on('error', reject);

    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

module.exports = router;
