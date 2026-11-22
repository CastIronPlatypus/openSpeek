import type { ReactNode } from 'react';
import type { Theme } from '../../types';
import { useSettings } from '../appModel';
import { FeedbackIcon, GearIcon, MoonIcon, SunIcon, SystemThemeIcon } from './icons';

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON: Record<Theme, ReactNode> = {
  system: <SystemThemeIcon />,
  light: <SunIcon />,
  dark: <MoonIcon />,
};

export function ThemeToggle() {
  const [{ theme }, update] = useSettings();
  const next = NEXT_THEME[theme];
  const label = `Theme: ${theme}. Switch to ${next}`;
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={() => update({ theme: next })}>
      {THEME_ICON[theme]}
    </button>
  );
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={onClick}>
      <GearIcon />
    </button>
  );
}

export function FeedbackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="Send feedback" title="Send feedback" onClick={onClick}>
      <FeedbackIcon />
    </button>
  );
}

interface AppHeaderProps {
  start: ReactNode;
  end: ReactNode;
}

export function AppHeader({ start, end }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-start">{start}</div>
        <div className="app-header-end">{end}</div>
      </div>
    </header>
  );
}
