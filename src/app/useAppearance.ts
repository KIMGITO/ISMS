// Theme (light/dark class and saved choice), the phone's status-bar style, and the
// branch's brand colours as CSS variables.
import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { statusBarService } from '../core/native';
import type { ActiveBusiness, ThemeMode } from './types';

/** onAuthScreen: the sign-in screens are always light, whatever the app theme. */
export function useAppearance(themeMode: ThemeMode, onAuthScreen: boolean, activeBusiness: ActiveBusiness) {
  const { isOnline } = useAppStore();

  // Dynamic branding variables mapping to DOM root
  useEffect(() => {
    if (activeBusiness && activeBusiness.primaryColor) {
      document.documentElement.style.setProperty(
        '--brand-primary',
        activeBusiness.primaryColor,
      );
      document.documentElement.style.setProperty(
        '--brand-primary-hover',
        activeBusiness.primaryColor + 'ee',
      );
    } else {
      document.documentElement.style.removeProperty('--brand-primary');
      document.documentElement.style.removeProperty('--brand-primary-hover');
    }

    if (activeBusiness && activeBusiness.secondaryColor) {
      document.documentElement.style.setProperty(
        '--brand-secondary',
        activeBusiness.secondaryColor,
      );
    } else {
      document.documentElement.style.removeProperty('--brand-secondary');
    }
  }, [activeBusiness]);

  // Handle dark class toggling on document root & save theme
  useEffect(() => {
    localStorage.setItem('isms-theme', themeMode);
    const root = window.document.documentElement;
    if (themeMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    statusBarService.setStyle(themeMode);
  }, [themeMode]);

  // Offline: the top bar turns red, so the phone's status-bar icons switch to white.
  useEffect(() => {
    statusBarService.setStyle(!isOnline ? 'dark' : onAuthScreen ? 'light' : themeMode);
  }, [isOnline, themeMode, onAuthScreen]);
}
