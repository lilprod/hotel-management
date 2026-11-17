import { Select, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ResourceManager } from '../ResourceManager';

const ENTITIES = ['guest', 'reservation', 'room', 'employee', 'product', 'work_order'];
const TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT'];
const schema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'snake_case'),
    labelFr: z.string().trim().min(1).max(120),
    labelEn: z.string().max(120).optional(),
    type: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTI_SELECT']),
    required: z.boolean().optional(),
    /** One option per line: `value=Label`. */
    optionsText: z.string().optional(),
  })
  .refine(
    (v) => !['SELECT', 'MULTI_SELECT'].includes(v.type) || parseOptions(v.optionsText).length > 0,
    {
      path: ['optionsText'],
      message: 'value=Label',
    },
  );

export function parseOptions(text?: string): { value: string; label: { fr: string } }[] {
  return (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [value = '', ...rest] = l.split('=');
      return { value: value.trim(), label: { fr: (rest.join('=') || value).trim() } };
    });
}

interface Row {
  id: string;
  entity: string;
  key: string;
  type: string;
  required: boolean;
  label: { fr: string; en?: string };
  options?: { value: string; label: { fr: string } }[] | null;
}

/** Custom fields builder (X5): per-entity field definitions used to validate `custom_fields`. */
export function CustomFieldsPage() {
  const { t } = useTranslation('settings');
  const [entity, setEntity] = useState(ENTITIES[0]!);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Select
        aria-label={t('cf.entity')}
        value={entity}
        onChange={setEntity}
        style={{ minWidth: 220 }}
        options={ENTITIES.map((e) => ({ value: e, label: t(`cf.entities.${e}`) }))}
      />
      <ResourceManager<Row>
        key={entity}
        name="custom-fields"
        title={t(`cf.entities.${entity}`)}
        listPath={`/custom-fields/definitions?entity=${entity}`}
        basePath="/custom-fields/definitions"
        extra={{ entity }}
        schema={schema}
        defaults={{ type: 'TEXT', required: false }}
        fromRow={(r) => ({
          key: r.key,
          labelFr: r.label.fr,
          labelEn: r.label.en ?? '',
          type: r.type,
          required: r.required,
          optionsText: (r.options ?? []).map((o) => `${o.value}=${o.label.fr}`).join('\n'),
        })}
        toPayload={(v, editing) => {
          const label = { fr: v['labelFr'], ...(v['labelEn'] ? { en: v['labelEn'] } : {}) };
          const isSelect = ['SELECT', 'MULTI_SELECT'].includes(v['type'] as string);
          const options = isSelect ? { options: parseOptions(v['optionsText'] as string) } : {};
          return editing
            ? { label, required: !!v['required'], ...options }
            : { key: v['key'], type: v['type'], label, required: !!v['required'], ...options };
        }}
        columns={[
          { title: t('cf.key'), dataIndex: 'key' },
          { title: t('f.name'), render: (_: unknown, r: Row) => r.label.fr },
          { title: t('cf.type'), dataIndex: 'type', render: (v: string) => t(`cf.types.${v}`) },
          {
            title: t('cf.required'),
            dataIndex: 'required',
            render: (v: boolean) => (v ? t('yes') : t('no')),
          },
        ]}
        fields={[
          { name: 'key', label: 'cf.key', type: 'text', createOnly: true },
          { name: 'labelFr', label: 'lists.labelFr', type: 'text' },
          { name: 'labelEn', label: 'lists.labelEn', type: 'text' },
          {
            name: 'type',
            label: 'cf.type',
            type: 'select',
            createOnly: true,
            options: TYPES.map((v) => ({ value: v, label: t(`cf.types.${v}`) })),
          },
          { name: 'required', label: 'cf.required', type: 'switch' },
          { name: 'optionsText', label: 'cf.options', type: 'textarea' },
        ]}
      />
    </Space>
  );
}
