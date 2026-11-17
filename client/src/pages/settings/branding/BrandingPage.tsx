import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';

import { BrandingFormPanel } from './BrandingForm';
import { DomainPanel, useCustomDomainEnabled } from './DomainPanel';
import { TemplatesEditor } from './TemplatesEditor';

/** Tenant branding hub (TN-20…TN-25): identity, message templates, custom domain (PREMIUM). */
export function BrandingPage() {
  const { t } = useTranslation('branding');
  const domain = useCustomDomainEnabled();
  const tabs = [
    { key: 'identity', label: t('tabs.identity'), children: <BrandingFormPanel /> },
    { key: 'templates', label: t('tabs.templates'), children: <TemplatesEditor /> },
    ...(domain.enabled && domain.data
      ? [{ key: 'domain', label: t('tabs.domain'), children: <DomainPanel domain={domain.data} /> }]
      : []),
  ];
  return <Tabs items={tabs} destroyInactiveTabPane />;
}
