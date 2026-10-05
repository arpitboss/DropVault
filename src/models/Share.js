const mongoose = require('mongoose');
const { validateIpArray } = require('../utils/ipValidator');

/**
 * Mongoose Schema for the `shares` collection (V0-T06, V1-T07).
 * Manages access tokens (shortCode), expiration, consumption states, and V1 access policies.
 *
 * V1 Extensions (V1-T07):
 * - passwordHash: Optional bcrypt hash for password-protected shares
 * - ipAllow / ipDeny: Optional IP/CIDR allow/deny lists
 * - maxDownloads: Optional download cap (enforced atomically via Redis in V1-T09)
 * - downloadCount: Running download counter
 * - revokedAt: Timestamp for permanent share revocation
 * - ownerId: Optional user ownership (null for anonymous shares — dual-mode architecture)
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

    // --- V1 Extensions (V1-T07) ---

    /**
     * Bcrypt hash of share access password.
     * When set, recipients must provide the correct password to access the shared content.
     * Hashing is performed in the service layer — never store plaintext here.
     */
    passwordHash: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * IP/CIDR allowlist. When non-empty, only requests from matching IPs are permitted.
     * Example: ['192.168.1.0/24', '10.0.0.5']
     */
    ipAllow: {
      type: [String],
      default: [],
      validate: {
        validator: validateIpArray,
        message: 'ipAllow must contain valid IP addresses or CIDR ranges',
      },
    },

    /**
     * IP/CIDR denylist. Requests from matching IPs are rejected (checked after ipAllow).
     * Example: ['203.0.113.0/24']
     */
    ipDeny: {
      type: [String],
      default: [],
      validate: {
        validator: validateIpArray,
        message: 'ipDeny must contain valid IP addresses or CIDR ranges',
      },
    },

    /**
     * Maximum number of downloads allowed for this share.
     * When set, download count is tracked and enforced atomically via Redis (V1-T09).
     * null = unlimited downloads (subject to oneTime policy).
     */
    maxDownloads: {
      type: Number,
      default: null,
      min: [1, 'maxDownloads must be at least 1'],
    },

    /**
     * Running counter of successful downloads.
     * Incremented atomically in Redis (V1-T09) and periodically synced to MongoDB.
     */
    downloadCount: {
      type: Number,
      default: 0,
      min: [0, 'downloadCount cannot be negative'],
    },

    /**
     * Timestamp when the share was permanently revoked by the owner.
     * Once set, all access attempts return 410 Gone. Revocation is irreversible.
     */
    revokedAt: {
      type: Date,
      default: null,
    },

    /**
     * Optional reference to the user who created this share (dual-mode architecture).
     * - null for anonymous shares (no login required)
     * - ObjectId for authenticated shares (enables dashboard, revocation, management)
     */
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        return ret;
      },
    },
    toObject: {
      transform(doc, ret) {
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

const Share = mongoose.models.Share || mongoose.model('Share', shareSchema);

module.exports = Share;
