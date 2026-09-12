/**
 * Abstract Base Class for Storage Providers (STO-1, STO-3).
 * All file storage operations throughout DropVault must implement and go through this interface.
 */
class StorageProvider {
  /**
   * Saves a file buffer to storage.
   * @param {Buffer} buffer - File content buffer
   * @param {object} metadata - Optional metadata
   * @returns {Promise<{ storedName: string, storagePath: string }>}
   */
  async save(buffer, metadata = {}) {
    throw new Error('StorageProvider.save() must be implemented by subclass');
  }

  /**
   * Retrieves a file buffer from storage by storedName.
   * @param {string} storedName - Unique stored file identifier (UUID)
   * @returns {Promise<Buffer>}
   */
  async retrieve(storedName) {
    throw new Error('StorageProvider.retrieve() must be implemented by subclass');
  }

  /**
   * Deletes a file from storage by storedName.
   * @param {string} storedName - Unique stored file identifier (UUID)
   * @returns {Promise<boolean>}
   */
  async delete(storedName) {
    throw new Error('StorageProvider.delete() must be implemented by subclass');
  }

  /**
   * Checks whether a file exists in storage.
   * @param {string} storedName - Unique stored file identifier (UUID)
   * @returns {Promise<boolean>}
   */
  async exists(storedName) {
    throw new Error('StorageProvider.exists() must be implemented by subclass');
  }
}

module.exports = StorageProvider;
