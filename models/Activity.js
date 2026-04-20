const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Activity title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    date: {
      type: Date,
      required: [true, 'Activity date is required'],
      index: true,
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      trim: true,
    },
    maxParticipants: {
      type: Number,
      required: [true, 'Maximum participants is required'],
      min: [1, 'Must allow at least 1 participant'],
    },
    currentParticipants: {
      type: Number,
      default: 0,
      min: 0,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Virtual: Available spots ────────────────────────────────
activitySchema.virtual('availableSpots').get(function () {
  return this.maxParticipants - this.currentParticipants;
});

// ── Indexes for query performance ───────────────────────────
activitySchema.index({ title: 'text' });
activitySchema.index({ createdBy: 1 });

const Activity = mongoose.model('Activity', activitySchema);

module.exports = Activity;
