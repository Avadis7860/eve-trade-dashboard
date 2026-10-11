import '@testing-library/jest-dom';

process.env.EVE_CLIENT_ID = process.env.EVE_CLIENT_ID || 'test-client-id';
process.env.EVE_CLIENT_SECRET = process.env.EVE_CLIENT_SECRET || 'test-client-secret';
process.env.EVE_CALLBACK_URL = process.env.EVE_CALLBACK_URL || 'http://localhost:3000/api/auth/callback';
process.env.DATABASE_STORAGE_PATH = process.env.DATABASE_STORAGE_PATH || './.data/test_eve_trade_store.json';
