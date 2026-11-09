// Loaded before any test module so config/env.ts sees a deterministic environment.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'memory://';
process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-123';
process.env.OSRM_ENABLED = 'false';
process.env.DEMO_MODE = 'true';
process.env.SIMULATOR_ENABLED = 'false';
process.env.SMTP_HOST = '';
process.env.NO_SHOW_WAIT_MIN = '0';
process.env.LOG_LEVEL = 'silent';
