import { useTranslation } from 'react-i18next';

import { useTenantBranding } from '../branding';
import { demoAddress, demoHours, pick } from '../demo-content';
import { Reveal } from '../lib/Reveal';
import { Icon } from './Icon';

/** Schematic coastline map: an illustration, no external map or tracking. */
function MapIllustration({ label, pin }: { label: string; pin: string }) {
  return (
    <svg
      className="map-art"
      viewBox="0 0 480 360"
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="480" height="360" className="map-land" />
      <path
        className="map-water"
        d="M0 230 C60 200 110 250 180 228 C250 206 300 150 372 168 C420 180 452 160 480 142 V360 H0Z"
      />
      <path
        className="map-water-2"
        d="M0 280 C70 258 120 300 200 280 C270 262 330 226 400 240 C440 248 462 238 480 228 V360 H0Z"
      />
      <g className="map-roads">
        <path d="M-10 120 C80 110 150 150 240 130 S390 70 490 90" />
        <path d="M210 -10 C220 70 190 150 230 210" />
        <path d="M330 -10 C320 50 350 100 340 160" />
        <path d="M60 -10 C70 40 40 90 70 140" />
      </g>
      <g className="map-blocks">
        <rect x="262" y="38" width="46" height="30" rx="4" />
        <rect x="96" y="64" width="54" height="34" rx="4" />
        <rect x="380" y="108" width="52" height="30" rx="4" />
        <rect x="26" y="150" width="40" height="28" rx="4" />
        <rect x="140" y="164" width="44" height="26" rx="4" />
      </g>
      <g transform="translate(240 150)">
        <circle r="30" className="map-pulse" />
        <path
          className="map-pin"
          d="M0 34 C-18 14 -22 4 -22 -6 A22 22 0 0 1 22 -6 C22 4 18 14 0 34Z"
        />
        <circle cy="-6" r="8" className="map-pin-dot" />
      </g>
      <text x="240" y="206" textAnchor="middle" className="map-label">
        {pin}
      </text>
    </svg>
  );
}

export function ContactBlock() {
  const { t, i18n } = useTranslation();
  const branding = useTenantBranding();
  const contact = branding.contact;
  const address = contact?.address || pick(demoAddress, i18n.language);

  return (
    <section className="section contact" aria-labelledby="contact-title">
      <div className="container contact-grid">
        <Reveal className="contact-text">
          <h2 id="contact-title" className="section-title">
            {t('home:contact.title')}
          </h2>
          <p className="section-lead">{t('home:contact.lead')}</p>
          <dl className="contact-list">
            <div>
              <dt>
                <Icon name="pin" size={20} />
                <span>{t('home:contact.address')}</span>
              </dt>
              <dd>{address}</dd>
            </div>
            {contact?.phone ? (
              <div>
                <dt>
                  <Icon name="phone" size={20} />
                  <span>{t('home:contact.phone')}</span>
                </dt>
                <dd>
                  <a href={`tel:${contact.phone.replace(/\s+/g, '')}`}>{contact.phone}</a>
                </dd>
              </div>
            ) : null}
            {contact?.email ? (
              <div>
                <dt>
                  <Icon name="mail" size={20} />
                  <span>{t('home:contact.email')}</span>
                </dt>
                <dd>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>
                <Icon name="clock" size={20} />
                <span>{t('home:contact.hours')}</span>
              </dt>
              <dd>{pick(demoHours, i18n.language)}</dd>
            </div>
          </dl>
        </Reveal>
        <Reveal className="contact-map" delay={120}>
          <MapIllustration label={t('home:contact.map')} pin={branding.name} />
        </Reveal>
      </div>
    </section>
  );
}
