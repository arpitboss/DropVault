const request = require('supertest');
const express = require('express');
const AppError = require('../src/utils/AppError');
const { errorHandler, notFoundHandler } = require('../src/middleware/errorHandler');
const { requestLogger } = require('../src/middleware/requestLogger');
const app = require('../src/app');

describe('Error Handling Foundation (V0-T13)', () => {
  describe('AppError Class', () => {
    it('should create an AppError instance with default status 500', () => {
      const err = new AppError('Something went wrong');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
      expect(err.message).toBe('Something went wrong');
      expect(err.status).toBe(500);
      expect(err.statusCode).toBe(500);
      expect(err.isOperational).toBe(true);
      expect(err.details).toBeNull();
    });

    it('should support static helper factories with appropriate status codes', () => {
      const badReq = AppError.badRequest('Invalid payload', { field: 'email' });
      expect(badReq.status).toBe(400);
      expect(badReq.message).toBe('Invalid payload');
      expect(badReq.details).toEqual({ field: 'email' });

      const unauth = AppError.unauthorized();
      expect(unauth.status).toBe(401);

      const forbidden = AppError.forbidden();
      expect(forbidden.status).toBe(403);

      const notFound = AppError.notFound('Resource missing');
      expect(notFound.status).toBe(404);

      const gone = AppError.gone('Link expired');
      expect(gone.status).toBe(410);

      const tooLarge = AppError.payloadTooLarge('File too big');
      expect(tooLarge.status).toBe(413);

      const internal = AppError.internal('Database crash');
      expect(internal.status).toBe(500);
      expect(internal.isOperational).toBe(false);
    });
  });

  describe('Centralized errorHandler Middleware', () => {
    let testApp;

    beforeEach(() => {
      testApp = express();
      testApp.use(requestLogger);
      testApp.use(express.json());

      // Dummy routes for testing specific error types
      testApp.get('/test/operational', (req, res, next) => {
        next(AppError.badRequest('Custom operational failure', { reason: 'malformed_json' }));
      });

      testApp.get('/test/gone', (req, res, next) => {
        next(AppError.gone('Secret has expired'));
      });

      testApp.get('/test/unhandled-500', (req, res, next) => {
        next(new Error('Unexpected null pointer exception'));
      });

      testApp.get('/test/multer-size', (req, res, next) => {
        const multerError = new Error('File too large');
        multerError.name = 'MulterError';
        multerError.code = 'LIMIT_FILE_SIZE';
        next(multerError);
      });

      testApp.get('/test/mongoose-validation', (req, res, next) => {
        const valError = new Error('Validation failed: shortCode is required');
        valError.name = 'ValidationError';
        next(valError);
      });

      testApp.get('/test/mongoose-cast', (req, res, next) => {
        const castError = new Error('Cast to ObjectId failed');
        castError.name = 'CastError';
        castError.path = 'fileId';
        next(castError);
      });

      testApp.use(notFoundHandler);
      testApp.use(errorHandler);
    });

    it('should format AppError response with status code, message, and requestId', async () => {
      const res = await request(testApp).get('/test/operational').expect(400);

      expect(res.body).toHaveProperty('error', 'Custom operational failure');
      expect(res.body).toHaveProperty('requestId');
      expect(res.body.details).toEqual({ reason: 'malformed_json' });
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });

    it('should return 410 Gone for AppError.gone', async () => {
      const res = await request(testApp).get('/test/gone').expect(410);

      expect(res.body.error).toBe('Secret has expired');
      expect(res.body.requestId).toBeDefined();
    });

    it('should format Multer LIMIT_FILE_SIZE error as 413 with consistent message', async () => {
      const res = await request(testApp).get('/test/multer-size').expect(413);

      expect(res.body.error).toMatch(/exceeds the limit/i);
      expect(res.body.requestId).toBeDefined();
    });

    it('should format Mongoose ValidationError as 400', async () => {
      const res = await request(testApp).get('/test/mongoose-validation').expect(400);

      expect(res.body.error).toContain('Validation failed');
      expect(res.body.requestId).toBeDefined();
    });

    it('should format Mongoose CastError as 400 with field path', async () => {
      const res = await request(testApp).get('/test/mongoose-cast').expect(400);

      expect(res.body.error).toBe('Invalid format for field: fileId');
      expect(res.body.requestId).toBeDefined();
    });

    it('should return 404 for undefined routes via notFoundHandler', async () => {
      const res = await request(testApp).get('/api/completely-undefined-path').expect(404);

      expect(res.body.error).toContain('Cannot GET /api/completely-undefined-path');
      expect(res.body.requestId).toBeDefined();
    });

    it('should preserve incoming X-Request-Id header when provided by client', async () => {
      const customId = 'client-trace-1234567890';
      const res = await request(testApp)
        .get('/test/gone')
        .set('X-Request-Id', customId)
        .expect(410);

      expect(res.headers['x-request-id']).toBe(customId);
      expect(res.body.requestId).toBe(customId);
    });

    it('should hide internal error details and stack traces when NODE_ENV is production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const config = require('../src/config');
      const origConfigEnv = config.nodeEnv;
      config.nodeEnv = 'production';

      try {
        const res = await request(testApp).get('/test/unhandled-500').expect(500);

        // Client must receive generic error in production (LOG-2)
        expect(res.body.error).toBe('Internal server error');
        expect(res.body.requestId).toBeDefined();
        expect(res.body.stack).toBeUndefined();
      } finally {
        process.env.NODE_ENV = origEnv;
        config.nodeEnv = origConfigEnv;
      }
    });
  });

  describe('Integration with Main App Instance', () => {
    it('should set X-Request-Id header on valid requests to main app', async () => {
      const res = await request(app).get('/');

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
    });

    it('should return 404 with requestId for non-existent API routes on main app', async () => {
      const res = await request(app).get('/api/unknown-v0-resource').expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('requestId');
      expect(res.headers['x-request-id']).toBe(res.body.requestId);
    });
  });
});
