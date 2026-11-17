import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePropertyId } from '../PropertyContext';
import { ResourceManager } from '../ResourceManager';

const json = z.string().refine((s) => {
  try {
    return typeof JSON.parse(s) === 'object';
  } catch {
    return false;
  }
}, 'JSON');
const schema = z.object({
  kind: z.enum(['CANCELLATION', 'DEPOSIT']),
  name: z.string().trim().min(1).max(120),
  rules: json,
});

interface Row {
  id: string;
  kind: string;
  name: string;
  rules: Record<string, unknown>;
}

/** Cancellation / deposit policies: rules are JSON validated server-side by Zod. */
export function PoliciesPage() {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  if (!propertyId) return null;
  return (
    <ResourceManager<Row>
      name="policies"
      title={t('tabs.policies')}
      listPath={`/pricing/policies?propertyId=${propertyId}`}
      basePath="/pricing/policies"
      extra={{ propertyId }}
      schema={schema}
      defaults={{
        kind: 'CANCELLATION',
        rules: '{"tiers":[{"daysBefore":2,"penaltyPercent":0}],"noShowPercent":100}',
      }}
      fromRow={(r) => ({ kind: r.kind, name: r.name, rules: JSON.stringify(r.rules) })}
      toPayload={(v, editing) => {
        const rules = JSON.parse(v['rules'] as string) as unknown;
        return editing ? { name: v['name'], rules } : { kind: v['kind'], name: v['name'], rules };
      }}
      columns={[
        { title: t('f.name'), dataIndex: 'name' },
        {
          title: t('policies.kind'),
          dataIndex: 'kind',
          render: (k: string) => t(`policies.kinds.${k}`),
        },
      ]}
      fields={[
        {
          name: 'kind',
          label: 'policies.kind',
          type: 'select',
          createOnly: true,
          options: ['CANCELLATION', 'DEPOSIT'].map((k) => ({
            value: k,
            label: t(`policies.kinds.${k}`),
          })),
        },
        { name: 'name', label: 'f.name', type: 'text' },
        { name: 'rules', label: 'policies.rules', type: 'textarea' },
      ]}
    />
  );
}
