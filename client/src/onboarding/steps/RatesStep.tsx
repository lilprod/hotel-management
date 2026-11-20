import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Card, Checkbox, Flex, Form, Input, InputNumber, Skeleton, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { roomTypesKey, type Items, type RoomTypeDto, type StepProps } from './common';

interface Plan {
  id: string;
  code: string;
  name: string;
}
interface Rate {
  id: string;
  roomTypeId: string;
  seasonId: string | null;
  price: number;
}
interface Season {
  id: string;
  name: string;
  fromDate: string;
  toDate: string;
}

const PLAN_CODE = 'BAR';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isPrice = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Step 4: base rate plan, price per room type and an optional high season. */
export function RatesStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [seasonOn, setSeasonOn] = useState(false);
  const [seasonName, setSeasonName] = useState(t('rates.seasonNameDefault'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [seasonPrices, setSeasonPrices] = useState<Record<string, number | null>>({});
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  const types = useQuery({
    queryKey: roomTypesKey(propertyId),
    queryFn: () =>
      apiClient.get<Items<RoomTypeDto>>(`/lodging/room-types?propertyId=${propertyId}&limit=200`),
  });
  const plans = useQuery({
    queryKey: ['wizard', 'rate-plans', propertyId],
    queryFn: () =>
      apiClient.get<Items<Plan>>(`/pricing/rate-plans?propertyId=${propertyId}&limit=200`),
  });
  const plan = plans.data?.items.find((p) => p.code === PLAN_CODE) ?? plans.data?.items[0];
  const rates = useQuery({
    queryKey: ['wizard', 'rates', plan?.id],
    queryFn: () => apiClient.get<Items<Rate>>(`/pricing/rates?ratePlanId=${plan?.id}&limit=500`),
    enabled: !!plan,
  });
  const seasons = useQuery({
    queryKey: ['wizard', 'seasons', propertyId],
    queryFn: () =>
      apiClient.get<Items<Season>>(`/pricing/seasons?propertyId=${propertyId}&limit=200`),
  });
  const items = types.data?.items ?? [];

  // Prefill with what already exists (resume).
  useEffect(() => {
    if (seeded.current || !rates.isSuccess) return;
    seeded.current = true;
    const base: Record<string, number> = {};
    for (const r of rates.data.items) if (r.seasonId === null) base[r.roomTypeId] = r.price;
    setPrices(base);
  }, [rates.isSuccess, rates.data]);

  const stateRef = useRef({
    prices,
    seasonOn,
    seasonName,
    from,
    to,
    seasonPrices,
    items,
    plan,
    rates: rates.data?.items ?? [],
    seasons: seasons.data?.items ?? [],
  });
  stateRef.current = {
    prices,
    seasonOn,
    seasonName,
    from,
    to,
    seasonPrices,
    items,
    plan,
    rates: rates.data?.items ?? [],
    seasons: seasons.data?.items ?? [],
  };

  useEffect(() => {
    saveRef.current = async () => {
      const s = stateRef.current;
      setError(null);
      const entered = s.items.filter((rt) => isPrice(s.prices[rt.id]));
      const seasonRows = s.items.filter((rt) => isPrice(s.seasonPrices[rt.id]));
      if (s.items.some((rt) => s.prices[rt.id] != null && !isPrice(s.prices[rt.id]))) {
        setError(t('rates.errors.price'));
        return false;
      }
      if (
        s.seasonOn &&
        seasonRows.length > 0 &&
        (!s.seasonName.trim() || !DAY.test(s.from) || !DAY.test(s.to) || s.to < s.from)
      ) {
        setError(t('rates.errors.season'));
        return false;
      }
      try {
        if (!entered.length && !(s.seasonOn && seasonRows.length)) return true;
        let planId = s.plan?.id;
        if (!planId) {
          const created = await apiClient.post<Plan>('/pricing/rate-plans', {
            propertyId,
            code: PLAN_CODE,
            name: t('rates.planName'),
            mealPlan: 'RO',
            isPublic: true,
          });
          planId = created.id;
        }
        for (const rt of entered) {
          const price = s.prices[rt.id] as number;
          const existing = s.rates.find((r) => r.roomTypeId === rt.id && r.seasonId === null);
          if (!existing)
            await apiClient.post('/pricing/rates', {
              ratePlanId: planId,
              roomTypeId: rt.id,
              price,
            });
          else if (existing.price !== price)
            await apiClient.patch(`/pricing/rates/${existing.id}`, { price });
        }
        if (s.seasonOn && seasonRows.length) {
          const same = s.seasons.find(
            (x) => x.name === s.seasonName.trim() && x.fromDate === s.from && x.toDate === s.to,
          );
          const seasonId =
            same?.id ??
            (
              await apiClient.post<Season>('/pricing/seasons', {
                propertyId,
                name: s.seasonName.trim(),
                fromDate: s.from,
                toDate: s.to,
                priority: 10,
              })
            ).id;
          for (const rt of seasonRows) {
            const price = s.seasonPrices[rt.id] as number;
            const existing = s.rates.find((r) => r.roomTypeId === rt.id && r.seasonId === seasonId);
            if (!existing)
              await apiClient.post('/pricing/rates', {
                ratePlanId: planId,
                roomTypeId: rt.id,
                seasonId,
                price,
              });
            else if (existing.price !== price)
              await apiClient.patch(`/pricing/rates/${existing.id}`, { price });
          }
        }
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['wizard', 'rate-plans', propertyId] }),
          qc.invalidateQueries({ queryKey: ['wizard', 'rates'] }),
          qc.invalidateQueries({ queryKey: ['wizard', 'seasons', propertyId] }),
        ]);
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

  if (types.isLoading || plans.isLoading) return <Skeleton active />;
  if (items.length === 0) return <Alert type="info" showIcon message={t('rates.needTypes')} />;

  return (
    <>
      {error ? (
        <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}
      <Form layout="vertical" component={false}>
        <Flex vertical gap={12}>
          {items.map((rt) => (
            <Flex key={rt.id} gap={12} align="center" wrap="wrap">
              <label htmlFor={`price-${rt.id}`} style={{ flex: '1 1 180px', fontWeight: 500 }}>
                {rt.name}
              </label>
              <InputNumber
                id={`price-${rt.id}`}
                aria-label={`${t('rates.price')} ${rt.name}`}
                min={0}
                precision={0}
                step={1000}
                style={{ flex: '1 1 200px' }}
                value={prices[rt.id] ?? null}
                addonAfter={`XOF ${t('rates.perNight')}`}
                formatter={(v) => `${v ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}
                parser={(v) => Number((v ?? '').replace(/\D/g, ''))}
                onChange={(v) => setPrices((p) => ({ ...p, [rt.id]: v }))}
              />
            </Flex>
          ))}
        </Flex>
        <Card size="small" style={{ marginTop: 20 }}>
          <Checkbox checked={seasonOn} onChange={(e) => setSeasonOn(e.target.checked)}>
            {t('rates.season')}
          </Checkbox>
          <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0 24px' }}>
            {t('rates.seasonText')}
          </Typography.Paragraph>
          {seasonOn ? (
            <div style={{ marginTop: 12 }}>
              <Flex gap={12} wrap="wrap">
                <Form.Item
                  label={t('rates.seasonName')}
                  htmlFor="season-name"
                  style={{ flex: '2 1 200px' }}
                >
                  <Input
                    id="season-name"
                    value={seasonName}
                    onChange={(e) => setSeasonName(e.target.value)}
                  />
                </Form.Item>
                <Form.Item
                  label={t('rates.from')}
                  htmlFor="season-from"
                  style={{ flex: '1 1 150px' }}
                >
                  <Input
                    id="season-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </Form.Item>
                <Form.Item label={t('rates.to')} htmlFor="season-to" style={{ flex: '1 1 150px' }}>
                  <Input
                    id="season-to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </Form.Item>
              </Flex>
              <Flex vertical gap={8}>
                {items.map((rt) => (
                  <Flex key={rt.id} gap={12} align="center" wrap="wrap">
                    <label htmlFor={`sprice-${rt.id}`} style={{ flex: '1 1 180px' }}>
                      {rt.name}
                    </label>
                    <InputNumber
                      id={`sprice-${rt.id}`}
                      aria-label={`${t('rates.seasonPrice')} ${rt.name}`}
                      min={0}
                      precision={0}
                      step={1000}
                      style={{ flex: '1 1 200px' }}
                      value={seasonPrices[rt.id] ?? null}
                      addonAfter="XOF"
                      onChange={(v) => setSeasonPrices((p) => ({ ...p, [rt.id]: v }))}
                    />
                  </Flex>
                ))}
              </Flex>
            </div>
          ) : null}
        </Card>
      </Form>
    </>
  );
}
