const mongoose = require('mongoose');
const User = require('../src/models/User');
const config = require('../src/config');
const { connectDB, disconnectDB } = require('../src/config/db');

describe('User Model Schema & Validation (V1-T02)', () => {
  beforeAll(async () => {
    await connectDB(config.mongoUri);
    await User.syncIndexes();
  });

  afterAll(async () => {
    await User.deleteMany({ email: /@dropvault-test\.internal$/ });
    await disconnectDB();
  });

  const getValidUserPayload = () => ({
    email: `dev-${Date.now()}-${Math.random().toString(36).substring(7)}@dropvault-test.internal`,
    passwordHash: '$2b$12$e8YkY9c3B5Gq8Qz9n7O6m.d9F6V3k0L8M2p4A6Z8X1Y3C5E7G9I1K', // Mock bcrypt hash
    role: 'user',
  });

  describe('Schema Validation & Defaults', () => {
    it('should validate a complete and valid User document', async () => {
      const user = new User(getValidUserPayload());
      await expect(user.validate()).resolves.toBeUndefined();
    });

    it('should default role to "user"', () => {
      const payload = getValidUserPayload();
      delete payload.role;
      const user = new User(payload);
      expect(user.role).toEqual('user');
    });

    it('should allow valid role "admin"', async () => {
      const user = new User({ ...getValidUserPayload(), role: 'admin' });
      await expect(user.validate()).resolves.toBeUndefined();
      expect(user.role).toEqual('admin');
    });

    it('should reject invalid role enum values', async () => {
      const user = new User({ ...getValidUserPayload(), role: 'superadmin' });
      await expect(user.validate()).rejects.toThrow(/not a valid role/i);
    });

    it('should fail validation when email is missing', async () => {
      const payload = getValidUserPayload();
      delete payload.email;
      const user = new User(payload);
      await expect(user.validate()).rejects.toThrow(/email is required/i);
    });

    it('should fail validation when email format is invalid', async () => {
      const invalidEmails = [
        'plainaddress',
        '#@%^%#$@#$@#.com',
        '@example.com',
        'Joe Smith <email@example.com>',
        'email.example.com',
        'email@example@example.com',
        'email@example',
      ];

      for (const invalidEmail of invalidEmails) {
        const user = new User({ ...getValidUserPayload(), email: invalidEmail });
        await expect(user.validate()).rejects.toThrow(/valid email address/i);
      }
    });

    it('should normalize email to lowercase and trim whitespace', () => {
      const user = new User({
        ...getValidUserPayload(),
        email: '  DeV.User@DropVault-Test.Internal  ',
      });
      expect(user.email).toEqual('dev.user@dropvault-test.internal');
    });

    it('should fail validation when passwordHash is missing', async () => {
      const payload = getValidUserPayload();
      delete payload.passwordHash;
      const user = new User(payload);
      await expect(user.validate()).rejects.toThrow(/passwordHash is required/i);
    });

    it('should set default createdAt as a valid Date', () => {
      const user = new User(getValidUserPayload());
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(Date.now() - user.createdAt.getTime()).toBeLessThan(2000);
    });

    it('should not contain a plain password field in schema', () => {
      expect(User.schema.paths.password).toBeUndefined();
      expect(User.schema.paths.passwordHash).toBeDefined();
    });
  });

  describe('Security & Serialization (toJSON / toObject)', () => {
    it('should omit passwordHash when converted to JSON', () => {
      const user = new User(getValidUserPayload());
      const json = user.toJSON();

      expect(json.passwordHash).toBeUndefined();
      expect(json.email).toBeDefined();
      expect(json.role).toBeDefined();
      expect(json.createdAt).toBeDefined();
    });

    it('should omit passwordHash when converted to plain Object', () => {
      const user = new User(getValidUserPayload());
      const obj = user.toObject();

      expect(obj.passwordHash).toBeUndefined();
      expect(obj.email).toBeDefined();
      expect(obj.role).toBeDefined();
    });

    it('should allow direct property access to passwordHash for internal authentication', () => {
      const payload = getValidUserPayload();
      const user = new User(payload);

      expect(user.passwordHash).toEqual(payload.passwordHash);
    });
  });

  describe('Database Persistence & Unique Index', () => {
    it('should save and retrieve a user document from MongoDB', async () => {
      const payload = getValidUserPayload();
      const created = await User.create(payload);

      expect(created._id).toBeDefined();
      expect(created.email).toEqual(payload.email.toLowerCase());

      const found = await User.findById(created._id);
      expect(found).not.toBeNull();
      expect(found.email).toEqual(payload.email.toLowerCase());
      expect(found.role).toEqual('user');
      expect(found.passwordHash).toEqual(payload.passwordHash);
    });

    it('should enforce unique index on email', async () => {
      const payload = getValidUserPayload();
      await User.create(payload);

      // Attempt creating a second user with the same email
      await expect(User.create(payload)).rejects.toThrow(/E11000|duplicate key/i);

      // Attempt creating a user with the same email in different casing
      await expect(
        User.create({
          ...payload,
          email: payload.email.toUpperCase(),
        })
      ).rejects.toThrow(/E11000|duplicate key/i);
    });
  });
});
