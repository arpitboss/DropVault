const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StorageProvider = require('./StorageProvider');

/**
 * Local filesystem implementation of StorageProvider (STO-2).
 * Stores encrypted files on local disk outside web root (UPL-3).
 * Enforces server-side UUID filenames (UPL-2) and path traversal prevention (UPL-4).
 */
class LocalStorageProvider extends StorageProvider {
  /**
   * @param {object} options
   * @param {string} options.uploadDir - Absolute or relative path to storage directory
   */
  constructor(options = {}) {
    super();
    if (!options.uploadDir) {
      throw new Error('LocalStorageProvider requires uploadDir in options');
    }
    this.uploadDir = path.resolve(options.uploadDir);
  }

  /**
   * Ensures the storage directory exists on disk.
   */
  async ensureDirectoryExists() {
    await fs.promises.mkdir(this.uploadDir, { recursive: true });
  }

  /**
   * Validates storedName and safely resolves its full absolute path.
   * Prevents path traversal vulnerabilities (UPL-4).
   * @param {string} storedName
   * @returns {string} Fully qualified safe path
   */
  _resolveSafePath(storedName) {
    if (!storedName || typeof storedName !== 'string') {
      throw new Error('Invalid stored name: must be a non-empty string');
    }

    // Check for null bytes and path separators
    if (
      storedName.includes('\0') ||
      storedName.includes('/') ||
      storedName.includes('\\') ||
      storedName.includes('..')
    ) {
      throw new Error('Invalid stored name: path traversal detected');
    }

    // Ensure storedName is purely a basename
    if (path.basename(storedName) !== storedName) {
      throw new Error('Invalid stored name: path traversal detected');
    }

    const resolvedPath = path.resolve(this.uploadDir, storedName);

    // Verify resolved path strictly resides inside uploadDir
    const baseDir = this.uploadDir.endsWith(path.sep)
      ? this.uploadDir
      : `${this.uploadDir}${path.sep}`;

    if (!resolvedPath.startsWith(baseDir)) {
      throw new Error('Invalid stored name: path traversal detected');
    }

    return resolvedPath;
  }

  /**
   * Saves a buffer to local disk with a server-generated UUID filename.
   * @param {Buffer} buffer - Content to save
   * @param {object} [metadata={}] - Optional metadata
   * @returns {Promise<{ storedName: string, storagePath: string }>}
   */
  async save(buffer, metadata = {}) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('LocalStorageProvider.save() expects a Buffer');
    }

    await this.ensureDirectoryExists();

    // UPL-2: Server-side generated UUID filename — never user-supplied
    const storedName = crypto.randomUUID();
    const storagePath = this._resolveSafePath(storedName);

    await fs.promises.writeFile(storagePath, buffer);

    return {
      storedName,
      storagePath,
    };
  }

  /**
   * Retrieves file content from local disk.
   * @param {string} storedName - UUID filename
   * @returns {Promise<Buffer>}
   */
  async retrieve(storedName) {
    const storagePath = this._resolveSafePath(storedName);

    try {
      return await fs.promises.readFile(storagePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        const notFoundError = new Error(`File not found: ${storedName}`);
        notFoundError.code = 'ENOENT';
        throw notFoundError;
      }
      throw error;
    }
  }

  /**
   * Deletes a file from local disk.
   * @param {string} storedName - UUID filename
   * @returns {Promise<boolean>}
   */
  async delete(storedName) {
    const storagePath = this._resolveSafePath(storedName);

    try {
      await fs.promises.unlink(storagePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Checks if a file exists on local disk.
   * @param {string} storedName - UUID filename
   * @returns {Promise<boolean>}
   */
  async exists(storedName) {
    const storagePath = this._resolveSafePath(storedName);

    try {
      await fs.promises.access(storagePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = LocalStorageProvider;
