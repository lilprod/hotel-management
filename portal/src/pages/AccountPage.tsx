import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { PageHero } from '../components/PageHero';
import './sections.css';

const features: { key: 'stays' | 'invoices' | 'loyalty'; icon: IconName }[] = [
  { key: 'stays', icon: 'calendar' },
  { key: 'invoices', icon: 'mail' },
  { key: 'loyalty', icon: 'spa' },
];

export default function AccountPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero
        titleId="account-title"
        title={t('pages:account.title')}
        lead={t('pages:account.lead')}
        photo="garden"
      />
      <section className="section" aria-labelledby="account-soon">
        <div className="container narrow">
          <h2 id="account-soon" className="section-title">
            {t('pages:account.soonTitle')}
          </h2>
          <ul className="soon-list">
            {features.map((f) => (
              <li key={f.key}>
                <Icon name={f.icon} size={26} />
                <span>{t(`pages:account.features.${f.key}`)}</span>
              </li>
            ))}
          </ul>
          <p className="section-cta">
            <Link className="button" to="/booking">
              {t('pages:account.cta')}
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
