import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePropertyId } from '../PropertyContext';
import { ResourceManager } from '../ResourceManager';
import { clean, formatMoney } from '../util';

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  price: z.number().int().min(0),
  departmentCode: z.string().max(40).optional(),
  isActive: z.boolean().optional(),
});

export function ProductsPage() {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  if (!propertyId) return null;
  return (
    <ResourceManager<{
      id: string;
      name: string;
      price: number;
      currency: string;
      isActive: boolean;
    }>
      name="products"
      title={t('tabs.products')}
      listPath={`/catalog/products?propertyId=${propertyId}&includeInactive=true`}
      basePath="/catalog/products"
      extra={{ propertyId }}
      schema={schema}
      defaults={{ isActive: true }}
      toPayload={(v) => clean(v)}
      columns={[
        { title: t('f.name'), dataIndex: 'name' },
        {
          title: t('products.price'),
          dataIndex: 'price',
          render: (_: number, r) => formatMoney(r.price, r.currency),
        },
        {
          title: t('products.active'),
          dataIndex: 'isActive',
          render: (v: boolean) => (v ? t('yes') : t('no')),
        },
      ]}
      fields={[
        { name: 'name', label: 'f.name', type: 'text' },
        { name: 'price', label: 'products.price', type: 'number' },
        { name: 'departmentCode', label: 'products.department', type: 'text' },
        { name: 'isActive', label: 'products.active', type: 'switch' },
      ]}
    />
  );
}
