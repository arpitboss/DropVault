const mongoose = require('mongoose');

/**
 * Mongoose Schema for the `shares` collection (V0-T06).
 * Manages access tokens (shortCode), expiration, and consumption states for shared files/text.
 */
const shareSchema = new mongoose.Schema(
  {
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File',
      required: [true, 'fileId is required'],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ['file', 'text'],
        message: '{VALUE} is not a valid share type',
      },
      default: 'file',
      required: [true, 'type is required'],
    },
    shortCode: {
      type: String,
      required: [true, 'shortCode is required'],
      unique: true,
      trim: true,
      index: true,
    },
    oneTime: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

const Share = mongoose.models.Share || mongoose.model('Share', shareSchema);

module.exports = Share;
