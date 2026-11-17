import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { AccommodationCard } from '../components/AccommodationCard';
import { ContactBlock } from '../components/ContactBlock';
import { Icon } from '../components/Icon';
import { Photo } from '../components/Photo';
import { SearchBar } from '../components/SearchBar';
import { Testimonials } from '../components/Testimonials';
import { useTenantBranding } from '../branding';
import { demoAccommodations, demoHighlights } from '../demo-content';
import { Reveal } from '../lib/Reveal';
import { useReducedMotion } from '../lib/useReducedMotion';
import type { DemoPhotoKey } from '../media/photos';
import './home.css';

const features: { key: 'spa' | 'restaurant' | 'activities'; photo: DemoPhotoKey; to: string }[] = [
  { key: 'spa', photo: 'spa', to: '/spa' },
  { key: 'restaurant', photo: 'dish', to: '/restaurant' },
  { key: 'activities', photo: 'lagoon', to: '/activities' },
];

/** Slow parallax: writes the scroll offset to a CSS variable (no re-render, no layout). */
function useParallax(ref: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      node.style.setProperty('--py', String(Math.min(window.scrollY, window.innerHeight)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, reduced]);
}

export default function HomePage() {
  const { t } = useTranslation();
  const branding = useTenantBranding();
  const heroRef = useRef<HTMLDivElement>(null);
  useParallax(heroRef);

  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <div className="hero-media" ref={heroRef} aria-hidden="true">
          <Photo uploadedUrl={branding.heroUrl} demo="hero" alt="" sizes="100vw" priority />
        </div>
        <div className="container hero-inner">
          <h1 id="home-title" className="hero-title">
            {branding.name}
          </h1>
          <p className="hero-tagline">{t('home:hero.tagline')}</p>
          <div className="hero-actions">
            <Link className="button button-light" to="/booking">
              {t('home:hero.cta')}
            </Link>
            <a className="hero-link" href="#accommodations">
              {t('home:hero.discover')}
              <Icon name="arrow" size={18} />
            </a>
          </div>
        </div>
        <div className="container hero-search">
          <SearchBar />
        </div>
      </section>

      <section className="highlights" aria-label={t('home:highlights.label')}>
        <ul className="container highlights-list">
          {demoHighlights.map((h) => (
            <li key={h.key}>
              <Icon name={h.icon} size={28} />
              <span>{t(`home:highlights.${h.key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="accommodations" className="section" aria-labelledby="units-title">
        <div className="container">
          <Reveal className="section-head">
            <div>
              <h2 id="units-title" className="section-title">
                {t('home:accommodations.title')}
              </h2>
              <p className="section-lead">{t('home:accommodations.lead')}</p>
            </div>
            <Link className="text-link" to="/accommodations">
              {t('home:accommodations.seeAll')}
              <Icon name="arrow" size={18} />
            </Link>
          </Reveal>
          <ul className="unit-grid">
            {demoAccommodations.map((unit, i) => (
              <li key={unit.id}>
                <Reveal delay={i * 120}>
                  <AccommodationCard unit={unit} />
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {features.map((f, i) => (
        <section
          key={f.key}
          className={`feature${i % 2 === 1 ? ' is-reversed' : ''}${i === 0 ? '' : ' is-tight'}`}
          aria-labelledby={`${f.key}-title`}
        >
          <div className="container feature-grid">
            <Reveal className="feature-media">
              <div className="arch">
                <Photo demo={f.photo} alt="" sizes="(min-width: 64rem) 45vw, 90vw" />
              </div>
            </Reveal>
            <Reveal className="feature-text" delay={120}>
              <h2 id={`${f.key}-title`} className="section-title">
                {t(`home:${f.key}.title`)}
              </h2>
              <p>{t(`home:${f.key}.text`)}</p>
              <Link className="text-link" to={f.to}>
                {t(`home:${f.key}.cta`)}
                <Icon name="arrow" size={18} />
              </Link>
            </Reveal>
          </div>
        </section>
      ))}

      <Testimonials />
      <ContactBlock />
    </>
  );
}
