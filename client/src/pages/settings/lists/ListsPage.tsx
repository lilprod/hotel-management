import { Select, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ResourceManager } from '../ResourceManager';

const KEYS = [
  'reservation_source',
  'guest_segment',
  'cancel_reason',
  'task_type',
  'product_category',
  'tag',
];
const schema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/),
  labelFr: z.string().trim().min(1).max(120),
  labelEn: z.string().max(120).optional(),
  active: z.boolean().optional(),
});

interface Row {
  id: string;
  code: string;
  label: { fr: string; en?: string };
  active: boolean;
  isSystem: boolean;
}

/** Configurable lists (X6): sources, segments, cancellation reasons, product categories… */
export function ListsPage() {
  const { t } = useTranslation('settings');
  const [key, setKey] = useState(KEYS[0]!);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select
        aria-label={t('lists.list')}
        value={key}
        onChange={setKey}
        style={{ minWidth: 260 }}
        options={KEYS.map((k) => ({ value: k, label: t(`lists.keys.${k}`) }))}
      />
      <ResourceManager<Row>
        key={key}
        name="lookups"
        title={t(`lists.keys.${key}`)}
        listPath={`/lookups/${key}?includeInactive=true`}
        basePath={`/lookups/${key}`}
        schema={schema}
        defaults={{ active: true }}
        fromRow={(r) => ({
          code: r.code,
          labelFr: r.label.fr,
          labelEn: r.label.en ?? '',
          active: r.active,
        })}
        toPayload={(v, editing) => {
          const label = { fr: v['labelFr'], ...(v['labelEn'] ? { en: v['labelEn'] } : {}) };
          return editing
            ? { label, active: v['active'] }
            : { code: v['code'], label, active: v['active'] ?? true };
        }}
        columns={[
          { title: t('f.code'), dataIndex: 'code' },
          { title: t('lists.labelFr'), render: (_: unknown, r: Row) => r.label.fr },
          { title: t('lists.labelEn'), render: (_: unknown, r: Row) => r.label.en ?? '' },
          {
            title: t('products.active'),
            dataIndex: 'active',
            render: (v: boolean) => (v ? t('yes') : t('no')),
          },
        ]}
        fields={[
          { name: 'code', label: 'f.code', type: 'text', createOnly: true },
          { name: 'labelFr', label: 'lists.labelFr', type: 'text' },
          { name: 'labelEn', label: 'lists.labelEn', type: 'text' },
          { name: 'active', label: 'products.active', type: 'switch' },
        ]}
      />
    </Space>
  );
}
