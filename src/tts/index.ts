import type { EngineId, ServerStatus, SpeechEngine } from '../types';
import { PhononEngine } from './phonon';
import { RemoteEngine, ServerConnection } from './server';

export { PhononEngine, PHONON_DEVICE } from './phonon';

const server = new ServerConnection();
const engines = new Map<EngineId, SpeechEngine>();

/** One engine instance per id, created on first request. */
export function getEngine(id: EngineId): SpeechEngine {
  let engine = engines.get(id);
  if (!engine) {
    engine = id === 'phonon' ? new PhononEngine() : new RemoteEngine(id, server);
    engines.set(id, engine);
  }
  return engine;
}

/** Base URL of the openSpeek server; `''` means the page's own origin. */
export function setServerUrl(url: string): void {
  server.setUrl(url);
}

/** The server's base URL as set with `setServerUrl` (`''` = same origin), for other server APIs. */
export function getServerUrl(): string {
  return server.baseUrl;
}

/** What the server offers. Never rejects; cached for about 10 s, or `maxAgeMs` when given. */
export function getServerStatus(maxAgeMs?: number): Promise<ServerStatus> {
  return server.getStatus(maxAgeMs);
}
