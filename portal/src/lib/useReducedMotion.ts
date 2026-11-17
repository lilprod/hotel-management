import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function read(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false;
}

/** True when the visitor asked the OS/browser for reduced motion. Updates live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
