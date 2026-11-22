import { createContext, useContext } from 'react';
import { ENGINE_NEEDS_SERVER, type EngineId, type ServerStatus, type Settings } from '../types';
import { ENGINE_INFO, isEngineAvailable } from './engines';
import type { Services } from './services';
import { createSettingsStore, type SettingsStore } from './settings';
import { createStore, useStore, type Store } from './store';

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

/** App-wide state and the actions that keep the player and saved settings in step. */
export interface AppModel {
  services: Services;
  settings: SettingsStore;
  /** Engine in use this session; differs from `settings.engine` after a fallback. */
  activeEngine: Store<EngineId>;
  serverStatus: Store<ServerStatus | null>;
  /** A short, dismissable message shown as a toast. */
  notice: Store<string | null>;
  refreshServerStatus(): Promise<ServerStatus>;
  /** Uses the saved engine when the server offers it, otherwise Phonon on this device for this session. */
  ensureUsableEngine(): void;
  /** Applies the active engine, its voice and the rate to the player. */
  syncPlayer(): void;
  selectEngine(id: EngineId): void;
  selectVoice(name: string | null): void;
  setRate(rate: number): void;
}

export function clampRate(rate: number): number {
  return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)) * 100) / 100;
}

export async function createAppModel(services: Services): Promise<AppModel> {
  const { player } = services;
  const settings = await createSettingsStore(services.library);
  const activeEngine = createStore<EngineId>(settings.get().engine);
  const serverStatus = createStore<ServerStatus | null>(null);
  const notice = createStore<string | null>(null);
  let noticedFallback = false;

  const applyEngine = (engine: EngineId) => {
    activeEngine.set(engine);
    const voice = settings.get().voices[engine];
    const state = player.getState();
    if (state.engine !== engine) player.setEngine(engine, voice);
    else if (state.voice !== voice) player.setVoice(voice);
  };

  const model: AppModel = {
    services,
    settings,
    activeEngine,
    serverStatus,
    notice,
    async refreshServerStatus() {
      const status = await services.getServerStatus();
      serverStatus.set(status);
      return status;
    },
    ensureUsableEngine() {
      const desired = settings.get().engine;
      const status = serverStatus.get();
      if (ENGINE_NEEDS_SERVER[desired] && status === null) return;
      if (isEngineAvailable(desired, status)) {
        applyEngine(desired);
        return;
      }
      applyEngine('phonon');
      if (!noticedFallback) {
        noticedFallback = true;
        const { name, where } = ENGINE_INFO[desired];
        notice.set(`${name} (${where}) needs the openSpeek server, which isn’t available right now. Using Phonon on this device instead.`);
      }
    },
    syncPlayer() {
      applyEngine(activeEngine.get());
      player.setRate(settings.get().rate);
    },
    selectEngine(id) {
      settings.update({ engine: id });
      applyEngine(id);
    },
    selectVoice(name) {
      const engine = activeEngine.get();
      settings.update({ voices: { ...settings.get().voices, [engine]: name } });
      player.setVoice(name);
    },
    setRate(rate) {
      const r = clampRate(rate);
      settings.update({ rate: r });
      player.setRate(r);
    },
  };
  return model;
}

export const AppContext = createContext<AppModel | null>(null);

export function useApp(): AppModel {
  const model = useContext(AppContext);
  if (!model) throw new Error('useApp must be used inside <AppContext>');
  return model;
}

export function useSettings(): [Settings, SettingsStore['update']] {
  const { settings } = useApp();
  return [useStore(settings), settings.update];
}
