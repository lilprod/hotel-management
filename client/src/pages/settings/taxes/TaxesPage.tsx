import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePropertyId } from '../PropertyContext';
import { ResourceManager } from '../ResourceManager';
import { clean } from '../util';

const schema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['PERCENT', 'FIXED_PER_PERSON_NIGHT', 'FIXED_PER_NIGHT']),
  value: z.number().min(0),
  inclusive: z.boolean().optional(),
});

export function TaxesPage() {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  if (!propertyId) return null;
  return (
    <ResourceManager<{
      id: string;
      code: string;
      name: string;
      type: string;
      value: string;
      inclusive: boolean;
    }>
      name="taxes"
      title={t('tabs.taxes')}
      listPath={`/pricing/taxes?propertyId=${propertyId}`}
      basePath="/pricing/taxes"
      extra={{ propertyId, appliesTo: ['LODGING'] }}
      schema={schema}
      defaults={{ type: 'PERCENT', inclusive: false }}
      toPayload={(v, editing) => {
        const { code, type, ...rest } = clean(v);
        return editing ? rest : { code, type, ...rest };
      }}
      fromRow={(r) => ({ ...r, value: Number(r.value) })}
      columns={[
        { title: t('f.code'), dataIndex: 'code' },
        { title: t('f.name'), dataIndex: 'name' },
        { title: t('taxes.type'), dataIndex: 'type', render: (v: string) => t(`taxes.types.${v}`) },
        { title: t('taxes.value'), dataIndex: 'value' },
        {
          title: t('taxes.inclusive'),
          dataIndex: 'inclusive',
          render: (v: boolean) => (v ? t('yes') : t('no')),
        },
      ]}
      fields={[
        { name: 'code', label: 'f.code', type: 'text', createOnly: true },
        { name: 'name', label: 'f.name', type: 'text' },
        {
          name: 'type',
          label: 'taxes.type',
          type: 'select',
          createOnly: true,
          options: ['PERCENT', 'FIXED_PER_PERSON_NIGHT', 'FIXED_PER_NIGHT'].map((v) => ({
            value: v,
            label: t(`taxes.types.${v}`),
          })),
        },
        { name: 'value', label: 'taxes.value', type: 'number', decimal: true },
        { name: 'inclusive', label: 'taxes.inclusive', type: 'switch' },
      ]}
    />
  );
}
