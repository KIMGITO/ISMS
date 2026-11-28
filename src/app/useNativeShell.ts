// Installed-app behaviour: self-updates, hiding the splash screen, the Android Back button
// (overlay, then screen history, then the first tab, then exit) and keeping a focused
// field visible above the on-screen keyboard.
import { useEffect } from 'react';
import { updateService } from '../core/native/UpdateService';
import { nativePlatformService, splashScreenService, nativeUiService } from '../core/native';
import { useOverlayStore } from '../stores/overlayStore';
import { useUiStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { arrangeMobileNav, MORE_TAB_ID } from '../utils/mobileNav';
import { canOpenScreen } from '../utils/screens';
import { MOBILE_TABS } from './navConfig';

export function useNativeShell() {
  // Installed desktop and Android apps keep themselves up to date.
  useEffect(() => {
    updateService.start();
  }, []);

  // Hide native splash screen on first client mount
  useEffect(() => {
    splashScreenService.hide();
  }, []);

  // Native Android hardware Back Button interception and confirmation flow
  useEffect(() => {
    const unsubscribeBackButton = nativePlatformService.onBackButton(
      async () => {
        const { popTopOverlay } = useOverlayStore.getState();

        // Attempt to close the top-most active overlay (dialog, sheet, etc.)
        const didCloseOverlay = popTopOverlay();

        // If an overlay was closed, stop here.
        if (didCloseOverlay) {
          return;
        }

        // Then step back through the screens visited, like a browser.
        const ui = useUiStore.getState();
        if (ui.goBack()) return;

        // With no history left, the first screen of this role's bar comes before exiting.
        const role = useAuthStore.getState().currentEmployee?.role;
        if (role) {
          const allowed = MOBILE_TABS.filter((tab) => canOpenScreen(role, tab.id)).map((tab) => tab.id);
          const startTab = arrangeMobileNav(allowed, role).primary.find((id) => id !== MORE_TAB_ID);
          if (startTab && ui.activeTab !== startTab) {
            useUiStore.setState({ activeTab: startTab as any, tabHistory: [] });
            return;
          }
        }

        // If no overlay was closed, confirm exit
        const shouldExit = await nativeUiService.confirm(
          'Exit Application',
          'Exit the application?',
        );
        if (shouldExit) {
          nativePlatformService.exitApp();
        }
      },
    );
    return unsubscribeBackButton;
  }, []);

  // Ensure focused form input is always visible when the virtual keyboard opens
  useEffect(() => {
    const handleScrollActiveElement = () => {
      // Short delay to allow keyboard animations / viewport resizing to finish
      setTimeout(() => {
        const activeEl = document.activeElement;
        if (activeEl) {
          const isInput =
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.closest("[contenteditable='true']");
          if (isInput) {
            activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 150);
    };

    let removeKeyboardListener: (() => void) | undefined;

    if (nativePlatformService.isNative()) {
      removeKeyboardListener = nativeUiService.onKeyboardShow(() => {
        handleScrollActiveElement();
      });
    } else if (window.visualViewport) {
      const visualViewport = window.visualViewport;
      visualViewport.addEventListener('resize', handleScrollActiveElement);
      return () => {
        visualViewport.removeEventListener('resize', handleScrollActiveElement);
      };
    }

    return () => {
      if (removeKeyboardListener) {
        removeKeyboardListener();
      }
    };
  }, []);
}
