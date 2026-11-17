import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ElementType, ReactNode } from 'react';

import { useReducedMotion } from './useReducedMotion';

/**
 * Reports whether the element has entered the viewport (once). Without IntersectionObserver,
 * or with reduced motion, content is shown straight away so it never stays hidden.
 */
export function useReveal<T extends HTMLElement>(threshold = 0.12) {
  const ref = useRef<T>(null);
  const reduced = useReducedMotion();
  const supported = typeof IntersectionObserver !== 'undefined';
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !supported || reduced) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -6% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [supported, reduced, threshold]);

  return { ref, visible: seen || reduced || !supported };
}

interface RevealProps {
  children: ReactNode;
  /** Stagger delay in ms. */
  delay?: number;
  as?: ElementType;
  className?: string;
}

/** Fade / slide-up on first view. Pure CSS transition, disabled by `prefers-reduced-motion`. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className }: RevealProps) {
  const { ref, visible } = useReveal<HTMLElement>();
  const style = { '--d': `${delay}ms` } as CSSProperties;
  return (
    <Tag
      ref={ref}
      className={`reveal${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      {children}
    </Tag>
  );
}
