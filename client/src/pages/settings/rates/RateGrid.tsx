import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, InputNumber, Select, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, ApiError, type Items, type RoomType } from '../api';
import { usePropertyId } from '../PropertyContext';
import { DOW_ALL, DOW_WEEKEND } from '../util';

interface Rate {
  id: string;
  roomTypeId: string;
  seasonId: string | null;
  dowMask: number;
  price: number;
  extraAdult: number;
  extraChild: number;
  minStay: number;
}
interface Plan {
  id: string;
  code: string;
  name: string;
}
interface Season {
  id: string;
  name: string;
}
type Col = 'price' | 'weekend' | 'extraAdult' | 'extraChild' | 'minStay';
interface GridRow {
  key: string;
  roomType: RoomType;
  season: Season | null;
}

/** Rate grid editor: room type × season rows; price, weekend price, extras and min stay columns. */
export function RateGrid() {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  const qc = useQueryClient();
  const [planId, setPlanId] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const plans = useQuery({
    queryKey: ['rate-plans', 'grid', propertyId],
    queryFn: () => api<Items<Plan>>('GET', `/pricing/rate-plans?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
  const types = useQuery({
    queryKey: ['rooms', 'grid-types', propertyId],
    queryFn: () => api<Items<RoomType>>('GET', `/lodging/room-types?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
  const seasons = useQuery({
    queryKey: ['seasons', 'grid', propertyId],
    queryFn: () => api<Items<Season>>('GET', `/pricing/seasons?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
  const rates = useQuery({
    queryKey: ['rates', planId],
    queryFn: () => api<Items<Rate>>('GET', `/pricing/rates?ratePlanId=${planId}`),
    enabled: !!planId,
  });

  const find = (r: GridRow, mask: number) =>
    rates.data?.items.find(
      (x) =>
        x.roomTypeId === r.roomType.id &&
        x.seasonId === (r.season?.id ?? null) &&
        x.dowMask === mask,
    );

  const save = useMutation({
    mutationFn: async (a: { row: GridRow; col: Col; value: number }) => {
      const mask = a.col === 'weekend' ? DOW_WEEKEND : DOW_ALL;
      const cur = find(a.row, mask);
      const field = a.col === 'weekend' ? 'price' : a.col;
      if (cur) return api('PATCH', `/pricing/rates/${cur.id}`, { [field]: a.value });
      return api('POST', '/pricing/rates', {
        ratePlanId: planId,
        roomTypeId: a.row.roomType.id,
        seasonId: a.row.season?.id ?? null,
        dowMask: mask,
        price: field === 'price' ? a.value : 0,
        ...(field !== 'price' ? { [field]: a.value } : {}),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates', planId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error')),
  });

  const rows: GridRow[] = (types.data?.items ?? []).flatMap((rt) => [
    { key: `${rt.id}:base`, roomType: rt, season: null },
    ...(seasons.data?.items ?? []).map((s) => ({
      key: `${rt.id}:${s.id}`,
      roomType: rt,
      season: s,
    })),
  ]);

  const cell = (col: Col) => (_: unknown, row: GridRow) => {
    const rate = find(row, col === 'weekend' ? DOW_WEEKEND : DOW_ALL);
    const value = rate ? (col === 'weekend' ? rate.price : rate[col]) : undefined;
    return (
      <InputNumber
        aria-label={`${t(`rates.${col}`)} ${row.roomType.code} ${row.season?.name ?? t('rates.base')}`}
        min={col === 'minStay' ? 1 : 0}
        precision={0}
        controls={false}
        defaultValue={value}
        key={`${row.key}:${col}:${value ?? ''}`}
        disabled={col !== 'price' && col !== 'weekend' && !find(row, DOW_ALL)}
        onBlur={(e) => {
          const raw = e.target.value.replace(/\s/g, '');
          if (raw === '') return;
          const n = Number(raw);
          if (Number.isInteger(n) && n !== value) save.mutate({ row, col, value: n });
        }}
      />
    );
  };

  return (
    <section aria-label={t('rates.grid')}>
      <h2>{t('rates.grid')}</h2>
      <Select
        aria-label={t('rates.plan')}
        placeholder={t('rates.plan')}
        style={{ minWidth: 260, marginBottom: 12 }}
        value={planId}
        onChange={setPlanId}
        options={(plans.data?.items ?? []).map((p) => ({
          value: p.id,
          label: `${p.code} — ${p.name}`,
        }))}
      />
      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 12 }}
        />
      )}
      {planId && (
        <Table<GridRow>
          size="small"
          rowKey="key"
          pagination={false}
          loading={rates.isLoading}
          dataSource={rows}
          columns={[
            { title: t('rooms.type'), render: (_: unknown, r: GridRow) => r.roomType.code },
            {
              title: t('rates.season'),
              render: (_: unknown, r: GridRow) => r.season?.name ?? t('rates.base'),
            },
            { title: t('rates.price'), render: cell('price') },
            { title: t('rates.weekend'), render: cell('weekend') },
            { title: t('rates.extraAdult'), render: cell('extraAdult') },
            { title: t('rates.extraChild'), render: cell('extraChild') },
            { title: t('rates.minStay'), render: cell('minStay') },
          ]}
        />
      )}
    </section>
  );
}
