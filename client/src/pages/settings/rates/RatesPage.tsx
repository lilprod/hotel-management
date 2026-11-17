import { Space } from 'antd';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePropertyId } from '../PropertyContext';
import { ResourceManager } from '../ResourceManager';
import { clean } from '../util';
import { RateGrid } from './RateGrid';

const planSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(120),
  mealPlan: z.enum(['RO', 'BB', 'HB', 'FB']),
  isPublic: z.boolean().optional(),
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const seasonSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    fromDate: day,
    toDate: day,
    priority: z.number().int().min(0),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ['toDate'], message: '≥ from' });

export function RatesPage() {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  const addPlan = useRef<(() => void) | null>(null);
  if (!propertyId) return null;
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <ResourceManager<{ id: string; code: string; name: string; mealPlan: string }>
        name="rate-plans"
        addRef={addPlan}
        title={t('rates.plans')}
        listPath={`/pricing/rate-plans?propertyId=${propertyId}`}
        basePath="/pricing/rate-plans"
        extra={{ propertyId }}
        schema={planSchema}
        defaults={{ mealPlan: 'RO', isPublic: true }}
        toPayload={(v, editing) => {
          const { code, ...rest } = clean(v);
          return editing ? rest : { code, ...rest };
        }}
        columns={[
          { title: t('f.code'), dataIndex: 'code' },
          { title: t('f.name'), dataIndex: 'name' },
          {
            title: t('rates.meal'),
            dataIndex: 'mealPlan',
            render: (v: string) => t(`rates.mealPlans.${v}`, { defaultValue: v }),
          },
        ]}
        fields={[
          { name: 'code', label: 'f.code', type: 'text', createOnly: true },
          { name: 'name', label: 'f.name', type: 'text' },
          {
            name: 'mealPlan',
            label: 'rates.meal',
            type: 'select',
            options: ['RO', 'BB', 'HB', 'FB'].map((v) => ({
              value: v,
              label: `${v} — ${t(`rates.mealPlans.${v}`)}`,
            })),
          },
          { name: 'isPublic', label: 'rates.public', type: 'switch' },
        ]}
      />
      <ResourceManager<{
        id: string;
        name: string;
        fromDate: string;
        toDate: string;
        priority: number;
      }>
        name="seasons"
        title={t('rates.seasons')}
        listPath={`/pricing/seasons?propertyId=${propertyId}`}
        basePath="/pricing/seasons"
        extra={{ propertyId }}
        schema={seasonSchema}
        defaults={{ priority: 0 }}
        columns={[
          { title: t('f.name'), dataIndex: 'name' },
          { title: t('rates.from'), dataIndex: 'fromDate' },
          { title: t('rates.to'), dataIndex: 'toDate' },
          { title: t('rates.priority'), dataIndex: 'priority' },
        ]}
        fields={[
          { name: 'name', label: 'f.name', type: 'text' },
          { name: 'fromDate', label: 'rates.from', type: 'text' },
          { name: 'toDate', label: 'rates.to', type: 'text' },
          { name: 'priority', label: 'rates.priority', type: 'number' },
        ]}
      />
      <RateGrid onCreatePlan={() => addPlan.current?.()} />
    </Space>
  );
}
