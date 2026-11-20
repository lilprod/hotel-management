import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Flex, InputNumber, Skeleton, Switch, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { propertyKey, type Items, type PropertyDto, type StepProps } from './common';

interface Tax {
  id: string;
  code: string;
  name: string;
  type: 'PERCENT' | 'FIXED_PER_PERSON_NIGHT' | 'FIXED_PER_NIGHT';
  value: string;
  taxRuleId: string | null;
}
interface TaxRule {
  id: string;
  code: string;
  name: string | null;
  kind: string;
  rate: string;
}

const APPLIES_TO = ['LODGING', 'FOLIO', 'RESTAURANT', 'SPA', 'ACTIVITY', 'PRODUCT'];
const TOURIST_CODE = 'TAXE_SEJOUR';

/** Step 5: VAT (preselected, from the country's tax rules) and an optional tourist tax. */
export function TaxesStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const [vatOn, setVatOn] = useState(true);
  const [touristOn, setTouristOn] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  const property = useQuery({
    queryKey: propertyKey(propertyId),
    queryFn: () => apiClient.get<PropertyDto>(`/lodging/properties/${propertyId}`),
  });
  const taxes = useQuery({
    queryKey: ['wizard', 'taxes', propertyId],
    queryFn: () => apiClient.get<Items<Tax>>(`/pricing/taxes?propertyId=${propertyId}`),
  });
  const country = property.data?.country;
  const rules = useQuery({
    queryKey: ['wizard', 'tax-rules', country],
    queryFn: () => apiClient.get<Items<TaxRule>>(`/pricing/tax-rules?country=${country}`),
    enabled: !!country,
  });
  const vat = taxes.data?.items.find((x) => x.type === 'PERCENT');
  const tourist = taxes.data?.items.find(
    (x) => x.code === TOURIST_CODE || x.type === 'FIXED_PER_PERSON_NIGHT',
  );

  useEffect(() => {
    if (seeded.current || !taxes.isSuccess) return;
    seeded.current = true;
    if (tourist) {
      setTouristOn(true);
      setAmount(Math.round(Number(tourist.value)));
    }
  }, [taxes.isSuccess, tourist]);

  const ref = useRef({ vatOn, touristOn, amount, vat, tourist, rules: rules.data?.items ?? [] });
  ref.current = { vatOn, touristOn, amount, vat, tourist, rules: rules.data?.items ?? [] };

  useEffect(() => {
    saveRef.current = async () => {
      const s = ref.current;
      setError(null);
      if (s.touristOn && (!s.amount || s.amount < 1 || !Number.isInteger(s.amount))) {
        setError(t('taxes.errors.amount'));
        return false;
      }
      try {
        if (s.vatOn && !s.vat) {
          const rule = s.rules.find((r) => r.kind === 'PERCENT');
          const rate = rule ? Number(rule.rate) : 18;
          await apiClient.post('/pricing/taxes', {
            propertyId,
            ...(rule ? { taxRuleId: rule.id } : {}),
            code: `TVA${rate}`,
            name: rule?.name ?? `TVA ${rate} %`,
            type: 'PERCENT',
            value: rate,
            appliesTo: APPLIES_TO,
          });
        }
        if (s.touristOn && s.amount) {
          if (s.tourist) {
            if (Math.round(Number(s.tourist.value)) !== s.amount)
              await apiClient.patch(`/pricing/taxes/${s.tourist.id}`, { value: s.amount });
          } else
            await apiClient.post('/pricing/taxes', {
              propertyId,
              code: TOURIST_CODE,
              name: 'Taxe de séjour',
              type: 'FIXED_PER_PERSON_NIGHT',
              value: s.amount,
              appliesTo: ['LODGING'],
            });
        } else if (!s.touristOn && s.tourist) {
          await apiClient.delete(`/pricing/taxes/${s.tourist.id}`);
        }
        await qc.invalidateQueries({ queryKey: ['wizard', 'taxes', propertyId] });
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      }
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, propertyId, qc, message, t]);

  if (taxes.isLoading) return <Skeleton active />;
  return (
    <>
      {error ? (
        <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}
      <Flex vertical gap={12}>
        <Card size="small">
          <Flex justify="space-between" align="center" gap={12}>
            <div>
              <Typography.Text strong id="vat-label">
                {vat?.name ?? t('taxes.vat')}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">{t('taxes.vatText')}</Typography.Text>
            </div>
            {vat ? (
              <Tag color="green">{t('taxes.vatActive')}</Tag>
            ) : (
              <Switch aria-labelledby="vat-label" checked={vatOn} onChange={setVatOn} />
            )}
          </Flex>
        </Card>
        <Card size="small">
          <Flex justify="space-between" align="center" gap={12}>
            <div>
              <Typography.Text strong id="tourist-label">
                {t('taxes.tourist')}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">{t('taxes.touristText')}</Typography.Text>
            </div>
            <Switch aria-labelledby="tourist-label" checked={touristOn} onChange={setTouristOn} />
          </Flex>
          {touristOn ? (
            <div style={{ marginTop: 12 }}>
              <label htmlFor="tourist-amount" style={{ display: 'block', marginBottom: 4 }}>
                {t('taxes.touristAmount')}
              </label>
              <InputNumber
                id="tourist-amount"
                min={1}
                precision={0}
                step={100}
                style={{ width: 240, maxWidth: '100%' }}
                value={amount}
                addonAfter="XOF"
                onChange={setAmount}
              />
            </div>
          ) : null}
        </Card>
      </Flex>
    </>
  );
}
