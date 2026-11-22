#!/usr/bin/env node
/**
 * openSpeek server entry point. See server/README.md.
 */
import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config);

const server = http.createServer({ requestTimeout: 120_000, headersTimeout: 30_000 }, (req, res) => {
  app.handler(req, res);
});
server.keepAliveTimeout = 5_000;

server.listen(config.port, config.host, () => {
  const addr = server.address();
  const where = typeof addr === 'object' && addr ? `${addr.address}:${addr.port}` : String(addr);
  console.log(`[openspeek] listening on http://${where}`);
  console.log(
    `[openspeek] static: ${config.staticDir} | edge: ${config.edgeEnabled ? 'on' : 'off'} | ` +
      `phonon: ${config.phononUrl ? `http ${config.phononUrl}` : config.phononCmd ? `cli ${config.phononCmd}` : 'ptts on PATH if present'}` +
      (config.httpsProxy ? ' | outbound via HTTPS_PROXY' : ''),
  );
});

let stopping = false;
/** @param {string} signal */
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[openspeek] ${signal}: shutting down`);
  server.close(() => {
    app.close();
    process.exit(0);
  });
  server.closeIdleConnections();
  // Give in-flight requests a moment, then force.
  setTimeout(() => {
    server.closeAllConnections();
    app.close();
    process.exit(0);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
