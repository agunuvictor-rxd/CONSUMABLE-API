import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { asyncHandler, errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  app.get(
    '/config.js',
    asyncHandler((req, res) => {
      res
        .type('application/javascript')
        .send(`window.__API_BASE_URL__ = ${JSON.stringify(config.publicApiBaseUrl)};`);
    }),
  );

  app.use(express.static(config.publicDir, { index: 'index.html' }));

  app.use(config.prefix, rateLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}