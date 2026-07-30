import { useEffect } from 'react';
import { Platform } from 'react-native';

type Handlers = {
  /** ⌘K / Ctrl+K — reach the memory panel without the mouse. */
  onToggleSidebar?: () => void;
  /** Esc — close whatever is open. */
  onEscape?: () => void;
};

/**
 * Keyboard shortcuts, web only.
 *
 * This is the one place desktop genuinely beats touch, and it costs almost
 * nothing. Native is a no-op: there is no hardware keyboard to listen to, and
 * `document` does not exist.
 *
 * Deliberately narrow — two bindings that map to things already reachable by
 * pointer. A shortcut for an action with no visible control is a secret, not a
 * feature.
 */
export function useKeyboardShortcuts({ onToggleSidebar, onEscape }: Handlers) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      // metaKey for macOS, ctrlKey elsewhere. Checking both rather than
      // sniffing the platform means an external keyboard on either OS works.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        // Chrome focuses the address bar on Ctrl+K; without this the shortcut
        // would leave the page entirely.
        event.preventDefault();
        onToggleSidebar?.();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onToggleSidebar, onEscape]);
}
