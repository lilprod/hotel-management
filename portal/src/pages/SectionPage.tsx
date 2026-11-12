import { useTranslation } from 'react-i18next';

export type SectionKey = 'accommodations' | 'spa' | 'restaurant' | 'activities';

/** Placeholder for the public content sections (units, spa, restaurant, activities). */
export default function SectionPage({ section }: { section: SectionKey }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="section-title">
      <h1 id="section-title">{t(`pages:sections.${section}.title`)}</h1>
      <p className="lead">{t(`pages:sections.${section}.lead`)}</p>
      <p className="placeholder">{t('pages:sections.comingSoon')}</p>
    </section>
  );
}
