import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="nf-title">
      <h1 id="nf-title">{t('notFound.title')}</h1>
      <p className="lead">{t('notFound.body')}</p>
      <Link className="button" to="/">
        {t('notFound.home')}
      </Link>
    </section>
  );
}
