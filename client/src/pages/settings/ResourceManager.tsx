import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { Controller, useForm, type FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { ZodType } from 'zod';

import { api, ApiError, type Items } from './api';

export interface FieldDef {
  name: string;
  /** i18n key in the `settings` namespace. */
  label: string;
  type: 'text' | 'number' | 'switch' | 'select' | 'textarea';
  /** Number field accepting decimals (percentages). */
  decimal?: boolean;
  options?: { value: string; label: string }[];
  /** Only shown when creating (immutable afterwards). */
  createOnly?: boolean;
}

export interface ResourceManagerProps<Row extends { id: string }> {
  /** Unique react-query key part. */
  name: string;
  title: string;
  listPath: string;
  /** Path for POST (default listPath without query). */
  basePath: string;
  columns: ColumnsType<Row>;
  fields: FieldDef[];
  schema: ZodType;
  /** Values merged into the create payload (e.g. propertyId) and defaults of the form. */
  extra?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  canDelete?: boolean;
  /** Maps a form value to the API payload (e.g. string → array). */
  toPayload?: (v: FieldValues, editing: boolean) => unknown;
  fromRow?: (r: Row) => FieldValues;
}

/** Generic CRUD table + RHF/Zod modal form used by the settings pages. */
export function ResourceManager<Row extends { id: string }>(p: ResourceManagerProps<Row>) {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: [p.name, p.listPath],
    queryFn: () => api<Items<Row>>('GET', p.listPath),
  });
  const form = useForm<FieldValues>({
    resolver: zodResolver(p.schema as never),
    defaultValues: p.defaults ?? {},
  });
  const save = useMutation({
    mutationFn: (v: FieldValues) => {
      const isNew = editing === 'new';
      const payload = p.toPayload ? p.toPayload(v, !isNew) : v;
      return isNew
        ? api('POST', p.basePath, { ...p.extra, ...(payload as object) })
        : api('PATCH', `${p.basePath}/${(editing as Row).id}`, payload);
    },
    onSuccess: async () => {
      setEditing(null);
      await qc.invalidateQueries({ queryKey: [p.name] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error')),
  });
  const del = useMutation({
    mutationFn: (id: string) => api('DELETE', `${p.basePath}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [p.name] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error')),
  });

  const open = (row: Row | 'new') => {
    setError(null);
    form.reset(
      row === 'new' ? (p.defaults ?? {}) : p.fromRow ? p.fromRow(row) : (row as FieldValues),
    );
    setEditing(row);
  };
  const columns: ColumnsType<Row> = [
    ...p.columns,
    {
      key: 'actions',
      title: t('actions'),
      render: (_: unknown, row: Row) => (
        <Space>
          <Button size="small" onClick={() => open(row)}>
            {t('edit')}
          </Button>
          {p.canDelete !== false && (
            <Popconfirm title={t('confirmDelete')} onConfirm={() => del.mutate(row.id)}>
              <Button size="small" danger>
                {t('delete')}
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <section aria-label={p.title}>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
        <h2 style={{ margin: 0 }}>{p.title}</h2>
        <Button type="primary" onClick={() => open('new')}>
          {t('add')}
        </Button>
      </Space>
      {list.isError && <Alert type="error" message={t('error')} style={{ marginBottom: 12 }} />}
      {error && !editing && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
      <Table<Row>
        rowKey="id"
        size="small"
        loading={list.isLoading}
        dataSource={list.data?.items ?? []}
        columns={columns}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('add') : t('edit')}
        onCancel={() => setEditing(null)}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={save.isPending}
        onOk={form.handleSubmit((v) => save.mutate(v))}
        destroyOnClose
      >
        {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
        <Form layout="vertical" component={false}>
          {p.fields
            .filter((f) => !f.createOnly || editing === 'new')
            .map((f) => (
              <Controller
                key={f.name}
                name={f.name}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Form.Item
                    label={t(f.label)}
                    validateStatus={fieldState.error ? 'error' : undefined}
                    help={fieldState.error?.message}
                  >
                    {f.type === 'number' ? (
                      <InputNumber
                        aria-label={t(f.label)}
                        style={{ width: '100%' }}
                        value={field.value as number | null}
                        onChange={(v) => field.onChange(v ?? undefined)}
                        {...(f.decimal ? { step: 0.5 } : { precision: 0 })}
                      />
                    ) : f.type === 'switch' ? (
                      <Switch
                        aria-label={t(f.label)}
                        checked={!!field.value}
                        onChange={field.onChange}
                      />
                    ) : f.type === 'select' ? (
                      <Select
                        aria-label={t(f.label)}
                        value={field.value as string | undefined}
                        onChange={field.onChange}
                        options={f.options ?? []}
                      />
                    ) : f.type === 'textarea' ? (
                      <Input.TextArea
                        aria-label={t(f.label)}
                        rows={3}
                        {...field}
                        value={(field.value as string) ?? ''}
                      />
                    ) : (
                      <Input
                        aria-label={t(f.label)}
                        {...field}
                        value={(field.value as string) ?? ''}
                      />
                    )}
                  </Form.Item>
                )}
              />
            ))}
        </Form>
      </Modal>
    </section>
  );
}
