import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Modal, Select } from 'antd';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { api, ApiError } from '../api';
import { usePropertyId } from '../PropertyContext';
import { clean } from '../util';

const schema = z
  .object({
    roomTypeId: z.string().min(1),
    prefix: z.string().max(10).optional(),
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    floor: z.string().max(20).optional(),
  })
  .refine((v) => v.to >= v.from && v.to - v.from < 500, { path: ['to'], message: '≥ from, ≤ 500' });
type Values = z.infer<typeof schema>;

/** Bulk creation of numbered rooms, e.g. 101 → 130. */
export function BulkRooms({ roomTypes }: { roomTypes: { value: string; label: string }[] }) {
  const { t } = useTranslation('settings');
  const propertyId = usePropertyId();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema as never) });
  const run = useMutation({
    mutationFn: (v: Values) => api('POST', '/lodging/rooms/bulk', { propertyId, ...clean(v) }),
    onSuccess: async () => {
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['rooms'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error')),
  });
  const err = form.formState.errors;
  return (
    <>
      <Button
        onClick={() => {
          setError(null);
          form.reset({ prefix: '' });
          setOpen(true);
        }}
      >
        {t('rooms.bulk')}
      </Button>
      <Modal
        open={open}
        title={t('rooms.bulk')}
        onCancel={() => setOpen(false)}
        okText={t('rooms.bulkCreate')}
        cancelText={t('cancel')}
        confirmLoading={run.isPending}
        onOk={form.handleSubmit((v) => run.mutate(v))}
        destroyOnClose
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
        <Form layout="vertical" component={false}>
          <Form.Item
            label={t('rooms.type')}
            validateStatus={err.roomTypeId ? 'error' : undefined}
            help={err.roomTypeId?.message}
          >
            <Controller
              name="roomTypeId"
              control={form.control}
              render={({ field }) => (
                <Select aria-label={t('rooms.type')} options={roomTypes} {...field} />
              )}
            />
          </Form.Item>
          <Form.Item label={t('rooms.prefix')}>
            <Controller
              name="prefix"
              control={form.control}
              render={({ field }) => (
                <Input aria-label={t('rooms.prefix')} {...field} value={field.value ?? ''} />
              )}
            />
          </Form.Item>
          <Form.Item
            label={t('rooms.from')}
            validateStatus={err.from ? 'error' : undefined}
            help={err.from?.message}
          >
            <Controller
              name="from"
              control={form.control}
              render={({ field }) => (
                <InputNumber
                  aria-label={t('rooms.from')}
                  precision={0}
                  style={{ width: '100%' }}
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? undefined)}
                />
              )}
            />
          </Form.Item>
          <Form.Item
            label={t('rooms.to')}
            validateStatus={err.to ? 'error' : undefined}
            help={err.to?.message}
          >
            <Controller
              name="to"
              control={form.control}
              render={({ field }) => (
                <InputNumber
                  aria-label={t('rooms.to')}
                  precision={0}
                  style={{ width: '100%' }}
                  value={field.value}
                  onChange={(v) => field.onChange(v ?? undefined)}
                />
              )}
            />
          </Form.Item>
          <Form.Item label={t('f.floor')}>
            <Controller
              name="floor"
              control={form.control}
              render={({ field }) => (
                <Input aria-label={t('f.floor')} {...field} value={field.value ?? ''} />
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
