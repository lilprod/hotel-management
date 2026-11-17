import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ResourceManager } from '../ResourceManager';
import { clean } from '../util';

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  city: z.string().max(120).optional(),
  country: z.string().regex(/^[A-Z]{2}$/, 'XX'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'XXX')
    .optional(),
  timezone: z.string().min(1),
  checkinTime: z.string().regex(/^\d{2}:\d{2}$/),
  checkoutTime: z.string().regex(/^\d{2}:\d{2}$/),
  taxId: z.string().max(60).optional(),
  rccm: z.string().max(60).optional(),
});

interface Row {
  id: string;
  name: string;
  city: string | null;
  country: string;
  currency: string;
  timezone: string;
}

export function PropertyPage() {
  const { t } = useTranslation('settings');
  return (
    <ResourceManager<Row>
      name="properties"
      title={t('tabs.property')}
      listPath="/lodging/properties"
      basePath="/lodging/properties"
      canDelete={false}
      schema={schema}
      defaults={{
        country: 'TG',
        currency: 'XOF',
        timezone: 'Africa/Lome',
        checkinTime: '14:00',
        checkoutTime: '12:00',
      }}
      toPayload={(v, editing) => {
        const { currency, ...rest } = clean(v);
        return editing ? rest : { ...rest, currency };
      }}
      columns={[
        { title: t('f.name'), dataIndex: 'name' },
        { title: t('f.city'), dataIndex: 'city' },
        { title: t('f.country'), dataIndex: 'country' },
        { title: t('f.currency'), dataIndex: 'currency' },
      ]}
      fields={[
        { name: 'name', label: 'f.name', type: 'text' },
        { name: 'city', label: 'f.city', type: 'text' },
        { name: 'country', label: 'f.country', type: 'text' },
        { name: 'currency', label: 'f.currency', type: 'text', createOnly: true },
        { name: 'timezone', label: 'f.timezone', type: 'text' },
        { name: 'checkinTime', label: 'f.checkin', type: 'text' },
        { name: 'checkoutTime', label: 'f.checkout', type: 'text' },
        { name: 'taxId', label: 'f.taxId', type: 'text' },
        { name: 'rccm', label: 'f.rccm', type: 'text' },
      ]}
    />
  );
}
