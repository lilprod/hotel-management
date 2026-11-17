import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  active: boolean;
  onEscape: () => void;
  /** Element focused when the trap deactivates (defaults to the previously focused element). */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/** Keeps Tab / Shift+Tab inside `container`, closes on Escape and restores focus afterwards. */
export function useFocusTrap(container: RefObject<HTMLElement | null>, options: Options): void {
  const { active, returnFocusTo } = options;
  const onEscape = useRef(options.onEscape);
  onEscape.current = options.onEscape;

  useEffect(() => {
    const root = container.current;
    if (!active || !root) return;
    const previous = document.activeElement as HTMLElement | null;
    const returnTarget = returnFocusTo?.current ?? null;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (returnTarget ?? previous)?.focus?.();
    };
  }, [active, container, returnFocusTo]);
}
