import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(rootDir, 'config', 'app.config.json');

function readConfigFile() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }
  return value;
}

function loadConfig() {
  const file = readConfigFile();

  const port = intFromEnv('PORT', file.server.port);
  const defaultLimit = intFromEnv('DEFAULT_PAGE_LIMIT', file.pagination.defaultLimit);
  const maxLimit = intFromEnv('MAX_PAGE_LIMIT', file.pagination.maxLimit);
  const rateLimitMax = intFromEnv('RATE_LIMIT_MAX', file.rateLimit.max);

  if (defaultLimit > maxLimit) {
    throw new Error('pagination.defaultLimit cannot exceed pagination.maxLimit');
  }

  return {
    rootDir,
    prefix: '/api/v1',
    port,
    host: process.env.HOST || file.server.host,
    databasePath: process.env.DATABASE_PATH === ':memory:'
      ? ':memory:'
      : process.env.DATABASE_PATH
        ? path.resolve(rootDir, process.env.DATABASE_PATH)
        : path.resolve(rootDir, './data/app.db'),
    publicApiBaseUrl: process.env.API_BASE_URL || `http://localhost:${port}`,
    publicDir: path.join(rootDir, 'public'),
    trustProxy: process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1',
    pagination: {
      defaultLimit,
      maxLimit,
      defaultOffset: file.pagination.defaultOffset ?? 0,
    },
    rateLimit: {
      windowMs: file.rateLimit.windowMs,
      max: rateLimitMax,
      message: file.rateLimit.message,
    },
    seed: file.seed,
  };
}

export const config = loadConfig();
