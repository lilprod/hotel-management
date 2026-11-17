import { useQuery } from '@tanstack/react-query';
import { Alert, Select, Tabs } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@hm/ui';

import { api, type Items, type Property } from './api';
import { CustomFieldsPage } from './custom-fields/CustomFieldsPage';
import { ListsPage } from './lists/ListsPage';
import { PoliciesPage } from './policies/PoliciesPage';
import { ProductsPage } from './products/ProductsPage';
import { PropertyPage } from './property/PropertyPage';
import { PropertyContext } from './PropertyContext';
import { RatesPage } from './rates/RatesPage';
import { RoomsPage } from './rooms/RoomsPage';
import { TaxesPage } from './taxes/TaxesPage';

/** Lodging setup hub (OP-01…OP-08, X5, X6): one tab per resource, scoped to a property. */
export function SettingsPage() {
  const { t } = useTranslation('settings');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const props = useQuery({
    queryKey: ['properties'],
    queryFn: () => api<Items<Property>>('GET', '/lodging/properties'),
  });
  const first = props.data?.items[0]?.id ?? null;
  useEffect(() => {
    if (!propertyId && first) setPropertyId(first);
  }, [propertyId, first]);

  const tabs = [
    { key: 'property', label: t('tabs.property'), children: <PropertyPage /> },
    { key: 'rooms', label: t('tabs.rooms'), children: <RoomsPage /> },
    { key: 'rates', label: t('tabs.rates'), children: <RatesPage /> },
    { key: 'taxes', label: t('tabs.taxes'), children: <TaxesPage /> },
    { key: 'policies', label: t('tabs.policies'), children: <PoliciesPage /> },
    { key: 'products', label: t('tabs.products'), children: <ProductsPage /> },
    { key: 'lists', label: t('tabs.lists'), children: <ListsPage /> },
    { key: 'custom-fields', label: t('tabs.customFields'), children: <CustomFieldsPage /> },
  ];

  return (
    <PropertyContext.Provider value={propertyId}>
      <PageHeader title={t('title')} />
      {props.isError && <Alert type="error" message={t('error')} style={{ marginBottom: 12 }} />}
      <Select
        aria-label={t('property')}
        style={{ minWidth: 260, marginBottom: 16 }}
        value={propertyId ?? undefined}
        onChange={setPropertyId}
        placeholder={t('property')}
        options={(props.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
      />
      <Tabs items={tabs} destroyInactiveTabPane />
    </PropertyContext.Provider>
  );
}
