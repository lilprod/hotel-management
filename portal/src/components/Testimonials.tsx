import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { demoTestimonials, pick } from '../demo-content';
import { useReducedMotion } from '../lib/useReducedMotion';
import { Icon } from './Icon';

const INTERVAL_MS = 7000;

/**
 * Testimonials carousel. Auto-advances, but pauses on hover and focus, can be paused with a
 * button (WCAG 2.2.2), and never moves by itself under `prefers-reduced-motion`.
 */
export function Testimonials() {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const total = demoTestimonials.length;
  const auto = !reduced && !userPaused && !hovered && !focused;

  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % total), INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [auto, total, index]);

  const go = (next: number) => setIndex((next + total) % total);
  const item = demoTestimonials[index] as (typeof demoTestimonials)[number];

  return (
    <section
      className="testimonials"
      aria-roledescription="carousel"
      aria-label={t('home:testimonials.region')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div className="container testimonials-inner">
        <h2 className="section-title on-dark">{t('home:testimonials.title')}</h2>
        <Icon name="quote" size={44} className="quote-mark" />
        <div className="slide-viewport" aria-live={auto ? 'off' : 'polite'}>
          <figure
            key={item.id}
            className="slide"
            role="group"
            aria-roledescription="slide"
            aria-label={t('home:testimonials.goTo', { n: index + 1, total })}
          >
            <blockquote lang={i18n.language}>{pick(item.quote, i18n.language)}</blockquote>
            <figcaption>
              <strong>{item.author}</strong>
              <span>
                {pick(item.origin, i18n.language)}, {pick(item.stay, i18n.language).toLowerCase()}
              </span>
            </figcaption>
          </figure>
        </div>

        <div className="carousel-controls">
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label={t('home:testimonials.prev')}
          >
            <Icon name="chevronLeft" size={20} />
          </button>
          <ul className="dots">
            {demoTestimonials.map((slide, i) => (
              <li key={slide.id}>
                <button
                  type="button"
                  className="dot"
                  aria-label={t('home:testimonials.goTo', { n: i + 1, total })}
                  aria-current={i === index ? 'true' : undefined}
                  onClick={() => go(i)}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label={t('home:testimonials.next')}
          >
            <Icon name="chevronRight" size={20} />
          </button>
          {reduced ? null : (
            <button
              type="button"
              className="pause"
              aria-pressed={userPaused}
              aria-label={userPaused ? t('home:testimonials.play') : t('home:testimonials.pause')}
              onClick={() => setUserPaused((p) => !p)}
            >
              <Icon name={userPaused ? 'play' : 'pause'} size={18} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
