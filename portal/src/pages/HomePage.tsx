import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { tenantBranding } from '../branding';
import { portalRoutes } from '../routes';

const highlights = portalRoutes.filter((r) =>
  ['accommodations', 'spa', 'restaurant', 'activities'].includes(r.key),
);

export default function HomePage() {
  const { t } = useTranslation();
  return (
    <>
      <section className="hero" aria-labelledby="home-title">
        <p className="eyebrow">{tenantBranding.name}</p>
        <h1 id="home-title">{t('pages:home.title')}</h1>
        <p className="lead">{t('pages:home.lead')}</p>
        <Link className="button" to="/booking">
          {t('pages:home.cta')}
        </Link>
      </section>
      <ul className="cards">
        {highlights.map((r) => (
          <li key={r.key} className="card">
            <h2>{t(r.labelKey)}</h2>
            <p>{t(`pages:sections.${r.key}.lead`)}</p>
            <Link to={r.path}>
              {t('pages:home.discover')}
              <span className="visually-hidden"> : {t(r.labelKey)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
