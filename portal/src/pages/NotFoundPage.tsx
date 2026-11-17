import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { PageHero } from '../components/PageHero';
import './sections.css';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <PageHero
      titleId="nf-title"
      title={t('notFound.title')}
      lead={t('notFound.body')}
      photo="lagoon"
    >
      <p className="page-hero-actions">
        <Link className="button button-light" to="/">
          {t('notFound.home')}
        </Link>
      </p>
    </PageHero>
  );
}
