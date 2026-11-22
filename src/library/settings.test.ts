import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { settingsFromStored } from './settings';

describe('settingsFromStored', () => {
  it('fills missing fields and voice keys with defaults', () => {
    const s = settingsFromStored({ rate: 1.5, voices: { edge: 'x' } });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, rate: 1.5, voices: { ...DEFAULT_SETTINGS.voices, edge: 'x' } });
  });

  it('migrates a record with the old single `voice` field', () => {
    const s = settingsFromStored({ voice: 'Old Voice', rate: 2, theme: 'light', fontSize: 20, autoScroll: true, corsProxy: '' });
    expect(s.voices).toEqual({ phonon: 'Old Voice', 'phonon-server': null, edge: null });
    expect(s).not.toHaveProperty('voice');
    expect(s.rate).toBe(2);
  });

  it('ignores garbage and does not share the defaults object', () => {
    const s = settingsFromStored('junk');
    expect(s).toEqual(DEFAULT_SETTINGS);
    s.voices.edge = 'mutated';
    expect(DEFAULT_SETTINGS.voices.edge).toBeNull();
  });
});
