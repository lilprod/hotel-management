import { useQuery } from '@tanstack/react-query';
import { Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { StatusTag } from '@hm/ui';

import { api, type Items, type RoomType } from '../api';
import { usePropertyId } from '../PropertyContext';
import { ResourceManager } from '../ResourceManager';
import { clean } from '../util';
import { BulkRooms } from './BulkRooms';

const typeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).optional(),
  description: z.string().max(2000).optional(),
  descriptionEn: z.string().max(2000).optional(),
  maxAdults: z.number().int().min(1),
  maxChildren: z.number().int().min(0),
  baseOccupancy: z.number().int().min(1),
  beds: z.string().max(120).optional(),
});
const roomSchema = z.object({
  roomTypeId: z.string().min(1),
  number: z.string().trim().min(1).max(20),
  floor: z.string().max(20).optional(),
  building: z.string().max(60).optional(),
});

interface RoomTypeRow extends RoomType {
  maxAdults: number;
  description?: string | null;
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string> | null;
}

/** Form values ↔ API: `name` / `description` are French (default locale), `…En` the English one. */
export function roomTypePayload(v: Record<string, unknown>, editing: boolean) {
  const { code, nameEn, descriptionEn, ...rest } = clean(v) as Record<string, unknown>;
  const name = rest.name as string | undefined;
  const description = rest.description as string | undefined;
  const payload = {
    ...rest,
    nameI18n: { ...(name ? { fr: name } : {}), ...(nameEn ? { en: nameEn as string } : {}) },
    descriptionI18n:
      description || descriptionEn
        ? {
            ...(description ? { fr: description } : {}),
            ...(descriptionEn ? { en: descriptionEn as string } : {}),
          }
        : null,
  };
  return editing ? payload : { code, ...payload };
}

export const roomTypeFormValues = (r: RoomTypeRow) => ({
  ...r,
  name: r.nameI18n?.fr ?? r.name,
  nameEn: r.nameI18n?.en ?? '',
  description: r.descriptionI18n?.fr ?? r.description ?? '',
  descriptionEn: r.descriptionI18n?.en ?? '',
});

interface RoomRow {
  id: string;
  number: string;
  roomTypeId: string;
  floor: string | null;
  hkStatus: string;
}

export function RoomsPage() {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  const types = useQuery({
    queryKey: ['rooms', 'types-options', propertyId],
    queryFn: () => api<Items<RoomType>>('GET', `/lodging/room-types?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
  const options = (types.data?.items ?? []).map((r) => ({
    value: r.id,
    label: `${r.code} — ${r.name}`,
  }));
  const label = (id: string) => options.find((o) => o.value === id)?.label ?? id;
  if (!propertyId) return null;
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <ResourceManager<RoomTypeRow>
        name="room-types"
        title={t('rooms.types')}
        listPath={`/lodging/room-types?propertyId=${propertyId}`}
        basePath="/lodging/room-types"
        extra={{ propertyId }}
        schema={typeSchema}
        defaults={{ maxAdults: 2, maxChildren: 0, baseOccupancy: 2 }}
        toPayload={roomTypePayload}
        fromRow={roomTypeFormValues}
        columns={[
          { title: t('f.code'), dataIndex: 'code' },
          { title: t('f.name'), dataIndex: 'name' },
          {
            title: t('rooms.nameEn'),
            key: 'nameEn',
            render: (_: unknown, r: RoomTypeRow) => r.nameI18n?.en ?? '—',
          },
          { title: t('rooms.maxAdults'), dataIndex: 'maxAdults' },
        ]}
        fields={[
          { name: 'code', label: 'f.code', type: 'text', createOnly: true },
          { name: 'name', label: 'rooms.nameFr', type: 'text' },
          { name: 'nameEn', label: 'rooms.nameEn', type: 'text' },
          { name: 'description', label: 'rooms.descriptionFr', type: 'textarea' },
          { name: 'descriptionEn', label: 'rooms.descriptionEn', type: 'textarea' },
          { name: 'maxAdults', label: 'rooms.maxAdults', type: 'number' },
          { name: 'maxChildren', label: 'rooms.maxChildren', type: 'number' },
          { name: 'baseOccupancy', label: 'rooms.baseOccupancy', type: 'number' },
          { name: 'beds', label: 'rooms.beds', type: 'text' },
        ]}
      />
      <div>
        <BulkRooms roomTypes={options} />
        <ResourceManager<RoomRow>
          name="rooms"
          title={t('rooms.rooms')}
          listPath={`/lodging/rooms?propertyId=${propertyId}`}
          basePath="/lodging/rooms"
          extra={{ propertyId }}
          schema={roomSchema}
          toPayload={(v) => clean(v)}
          columns={[
            { title: t('rooms.number'), dataIndex: 'number' },
            { title: t('rooms.type'), dataIndex: 'roomTypeId', render: (id: string) => label(id) },
            { title: t('f.floor'), dataIndex: 'floor' },
            {
              title: t('rooms.hk'),
              dataIndex: 'hkStatus',
              render: (v: string) => (
                <StatusTag
                  status={v.toLowerCase()}
                  label={t(`rooms.hkStatus.${v}`, { defaultValue: v })}
                />
              ),
            },
          ]}
          fields={[
            { name: 'roomTypeId', label: 'rooms.type', type: 'select', options },
            { name: 'number', label: 'rooms.number', type: 'text' },
            { name: 'floor', label: 'f.floor', type: 'text' },
            { name: 'building', label: 'f.building', type: 'text' },
          ]}
        />
      </div>
    </Space>
  );
}
