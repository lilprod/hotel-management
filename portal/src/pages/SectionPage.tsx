import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { formatMoney, money } from '@hm/shared';

import { AccommodationCard } from '../components/AccommodationCard';
import { Gallery } from '../components/Gallery';
import { Icon } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import { demoAccommodations, demoGalleries, demoSections, pick } from '../demo-content';
import type { SectionId } from '../demo-content';
import { Reveal } from '../lib/Reveal';
import type { DemoPhotoKey } from '../media/photos';
import './sections.css';

export type SectionKey = SectionId;

const heroPhoto: Record<SectionId, DemoPhotoKey> = {
  accommodations: 'exterior',
  spa: 'spa',
  restaurant: 'restaurant',
  activities: 'snorkel',
};

/** Public content section (accommodations, spa, restaurant, activities): banner, offers, gallery. */
export default function SectionPage({ section }: { section: SectionKey }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const gallery = demoGalleries[section].map((g) => ({ demo: g.photo, alt: pick(g.alt, lang) }));

  return (
    <>
      <PageHero
        titleId="section-title"
        title={t(`pages:sections.${section}.title`)}
        lead={t(`pages:sections.${section}.lead`)}
        photo={heroPhoto[section]}
      />

      <section className="section section-intro" aria-labelledby="offers-title">
        <div className="container">
          <Reveal className="intro-text">
            <p className="intro-lead">{t(`pages:sections.${section}.intro`)}</p>
          </Reveal>
          <h2 id="offers-title" className="section-title">
            {t(`pages:sections.${section}.offersTitle`)}
          </h2>

          {section === 'accommodations' ? (
            <ul className="unit-grid is-large">
              {demoAccommodations.map((unit, i) => (
                <li key={unit.id}>
                  <Reveal delay={i * 100}>
                    <AccommodationCard unit={unit} featured />
                  </Reveal>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="offer-list">
              {demoSections[section].offers.map((offer, i) => (
                <li key={offer.name.fr}>
                  <Reveal delay={i * 90} className="offer">
                    <div className="offer-main">
                      <h3>{pick(offer.name, lang)}</h3>
                      <p>{pick(offer.desc, lang)}</p>
                    </div>
                    <p className="offer-side">
                      {offer.price ? (
                        <strong>
                          <span className="offer-from">{t('pages:sections.from')} </span>
                          {formatMoney(money(offer.price, 'XOF'))}
                        </strong>
                      ) : null}
                      {offer.duration ? (
                        <span className="offer-duration">
                          <Icon name="clock" size={16} />
                          {pick(offer.duration, lang)}
                        </span>
                      ) : null}
                    </p>
                  </Reveal>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section section-gallery" aria-labelledby="gallery-title">
        <div className="container">
          <h2 id="gallery-title" className="section-title">
            {t(`pages:sections.${section}.galleryTitle`)}
          </h2>
          <Gallery photos={gallery} />
          <p className="section-cta">
            <Link className="button" to="/booking">
              {t('pages:sections.bookCta')}
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
