import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Popconfirm,
  Typography,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { codeFor, roomTypesKey, type Items, type RoomTypeDto, type StepProps } from './common';

/** Step 2: room types (1..n), created one by one through the lodging API. */
export function RoomTypesStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState<number | null>(2);
  const [beds, setBeds] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: roomTypesKey(propertyId),
    queryFn: () =>
      apiClient.get<Items<RoomTypeDto>>(`/lodging/room-types?propertyId=${propertyId}&limit=200`),
  });
  const types = list.data?.items ?? [];
  const typesRef = useRef(types);
  typesRef.current = types;

  const create = useMutation({
    mutationFn: (v: { name: string; maxAdults: number; beds: string }) =>
      apiClient.post('/lodging/room-types', {
        propertyId,
        code: codeFor(
          v.name,
          typesRef.current.map((x) => x.code),
        ),
        name: v.name,
        maxAdults: v.maxAdults,
        baseOccupancy: Math.min(2, v.maxAdults),
        ...(v.beds ? { beds: v.beds } : {}),
      }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/lodging/room-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: roomTypesKey(propertyId) }),
    onError: (e) => setError(message(e)),
  });

  const add = useCallback(async (): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError(t('roomTypes.errors.name'));
      return false;
    }
    if (!capacity || capacity < 1 || capacity > 20) {
      setFieldError(t('roomTypes.errors.capacity'));
      return false;
    }
    setFieldError(null);
    setError(null);
    try {
      await create.mutateAsync({ name: trimmed, maxAdults: capacity, beds: beds.trim() });
      setName('');
      setBeds('');
      await qc.invalidateQueries({ queryKey: roomTypesKey(propertyId) });
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  }, [name, capacity, beds, create, qc, propertyId, message, t]);

  // "Next" also adds the type being typed, so nothing is lost.
  useEffect(() => {
    saveRef.current = async () => (name.trim() ? add() : true);
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, add, name]);

  return (
    <>
      {error ? (
        <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}
      {types.length === 0 && !list.isLoading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('roomTypes.none')} />
      ) : (
        <List
          size="small"
          bordered
          style={{ marginBottom: 16 }}
          loading={list.isLoading}
          dataSource={types}
          renderItem={(rt) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="rm"
                  title={t('roomTypes.removeConfirm')}
                  onConfirm={() => remove.mutate(rt.id)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`${t('roomTypes.remove')} ${rt.name}`}
                  />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={rt.name}
                description={[t('roomTypes.persons', { count: rt.maxAdults }), rt.beds]
                  .filter(Boolean)
                  .join(' · ')}
              />
            </List.Item>
          )}
        />
      )}
      <Form layout="vertical" component={false}>
        <Flex gap={12} wrap="wrap" align="flex-start">
          <Form.Item
            label={t('roomTypes.name')}
            htmlFor="rt-name"
            validateStatus={fieldError ? 'error' : ''}
            help={fieldError ? <span role="alert">{fieldError}</span> : undefined}
            style={{ flex: '2 1 220px' }}
          >
            <Input
              id="rt-name"
              value={name}
              placeholder={t('roomTypes.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
              onPressEnter={() => void add()}
            />
          </Form.Item>
          <Form.Item
            label={t('roomTypes.capacity')}
            htmlFor="rt-capacity"
            style={{ flex: '1 1 120px' }}
          >
            <InputNumber
              id="rt-capacity"
              min={1}
              max={20}
              precision={0}
              style={{ width: '100%' }}
              value={capacity}
              onChange={setCapacity}
            />
          </Form.Item>
          <Form.Item label={t('roomTypes.beds')} htmlFor="rt-beds" style={{ flex: '2 1 200px' }}>
            <Input
              id="rt-beds"
              value={beds}
              placeholder={t('roomTypes.bedsPlaceholder')}
              onChange={(e) => setBeds(e.target.value)}
            />
          </Form.Item>
        </Flex>
        <Button icon={<PlusOutlined />} onClick={() => void add()} loading={create.isPending}>
          {t('roomTypes.add')}
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        {t('roomTypes.text')}
      </Typography.Paragraph>
    </>
  );
}
