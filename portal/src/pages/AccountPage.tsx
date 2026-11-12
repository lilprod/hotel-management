import { useTranslation } from 'react-i18next';

export default function AccountPage() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="account-title">
      <h1 id="account-title">{t('pages:account.title')}</h1>
      <p className="lead">{t('pages:account.lead')}</p>
    </section>
  );
}
