import { UploadOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Table,
  Typography,
  Upload,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError, PageHeader } from '@hm/ui';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y, bind } from '../../components/Field';
import { autoAllocate, openInvoices, splitPayment, toPayload } from '../../billing/allocation';
import type { Allocations } from '../../billing/allocation';
import { METHODS, money, qs, todayIso, useFormatDate } from '../../billing/common';
import type { Invoice, Paged, Payment } from '../../billing/common';
import { TenantSelect } from '../../billing/hooks';
import { useMethodLabel } from '../../billing/ui';

const schema = z.object({
  tenantId: z.string().min(1, 'pay:validation.tenant'),
  amount: z
    .number('pay:validation.amount')
    .int('pay:validation.amount')
    .positive('pay:validation.amount')
    .max(Number.MAX_SAFE_INTEGER, 'pay:validation.amount'),
  paidAt: z
    .string()
    .min(1, 'pay:validation.date')
    .refine((d) => d <= todayIso(), 'pay:validation.dateFuture'),
  method: z.enum(METHODS),
  reference: z.string().trim().max(100, 'pay:validation.referenceMax').optional(),
  note: z.string().max(2000).optional(),
});
type Values = z.infer<typeof schema>;

export interface DuplicateInfo {
  existingPaymentId: string | null;
}

/** `CONFLICT` + `meta.reason = DUPLICATE_REFERENCE` carries the id of the payment already recorded. */
export function duplicateOf(err: unknown): DuplicateInfo | null {
  if (err instanceof ApiError && err.status === 409 && err.reason === 'DUPLICATE_REFERENCE') {
    const id = err.meta?.['existingPaymentId'];
    return { existingPaymentId: typeof id === 'string' ? id : null };
  }
  return null;
}

/** SA-32: manual payment form (allocation oldest-open-first, remainder → tenant credit). */
export function PaymentFormPage() {
  const { t } = useTranslation('pay');
  const { t: tb } = useTranslation('billing');
  const message = useApiError();
  const methodLabel = useMethodLabel();
  const fmt = useFormatDate();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const today = todayIso();

  const form = useForm<Values>({
    resolver: zodResolver(schema) as Resolver<Values>,
    defaultValues: {
      tenantId: params.get('tenantId') ?? '',
      paidAt: today,
      method: 'MIXX',
      reference: '',
      note: '',
    },
  });
  const errors = form.formState.errors;
  const tenantId = form.watch('tenantId');
  const amount = form.watch('amount');

  const invoicesQuery = useQuery({
    queryKey: ['tenant-open-invoices', tenantId],
    enabled: Boolean(tenantId),
    queryFn: () => apiClient.get<Paged<Invoice>>(`/invoices${qs({ tenantId, limit: 200 })}`),
  });
  const open = useMemo(() => openInvoices(invoicesQuery.data?.items ?? []), [invoicesQuery.data]);

  // Allocation: pre-filled oldest-open-first until the user edits a line by hand.
  const [manual, setManual] = useState<Allocations | null>(null);
  const allocations = useMemo<Allocations>(
    () => manual ?? autoAllocate(Number(amount), open),
    [manual, amount, open],
  );
  useEffect(() => {
    setManual(null);
  }, [tenantId]);
  const split = splitPayment(Number(amount), allocations);

  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);

  // One Idempotency-Key per submit: a retry of the same body reuses it, a changed body gets a new one.
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const idempotencyKey = (body: unknown) => {
    const json = JSON.stringify(body);
    if (attempt.current?.body !== json) attempt.current = { body: json, key: crypto.randomUUID() };
    return attempt.current.key;
  };

  const upload = async (file: File) => {
    setUploadError(null);
    if (!tenantId) {
      setUploadError(t('validation.tenantFirst'));
      return;
    }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await apiClient.post<{ fileId: string }>(
        `/payments/attachments${qs({ tenantId })}`,
        fd,
      );
      setFileId(r.fileId);
      setFileName(file.name);
    } catch (e) {
      setUploadError(message(e));
    }
  };

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    setDuplicate(null);
    if (split.overAllocated) {
      setFormError(t('overAllocated'));
      return;
    }
    const body = {
      tenantId: v.tenantId,
      amount: v.amount,
      method: v.method,
      paidAt: v.paidAt,
      ...(v.reference?.trim() ? { reference: v.reference.trim() } : {}),
      ...(fileId ? { attachmentFileId: fileId } : {}),
      ...(v.note?.trim() ? { note: v.note.trim() } : {}),
      allocations: toPayload(allocations),
    };
    try {
      const p = await apiClient.post<Payment>('/payments', body, {
        headers: { 'Idempotency-Key': idempotencyKey(body) },
      });
      await qc.invalidateQueries({ queryKey: ['payments'] });
      await qc.invalidateQueries({ queryKey: ['billing-dashboard'] });
      navigate(`/payments/${p.id}`);
    } catch (e) {
      const dup = duplicateOf(e);
      if (dup) setDuplicate(dup);
      else setFormError(message(e));
    }
  });

  return (
    <>
      <PageHeader
        title={t('new')}
        subtitle={t('newSubtitle')}
        breadcrumb={[{ title: <Link to="/payments">{t('title')}</Link> }, { title: t('new') }]}
      />
      <form noValidate onSubmit={(e) => void submit(e)} aria-label={t('new')}>
        <Form layout="vertical" component={false}>
          <Card size="small" style={{ maxWidth: 960 }}>
            <Field id="pay-tenant" label={t('tenant')} required error={errors.tenantId?.message}>
              <Controller
                control={form.control}
                name="tenantId"
                render={({ field }) => (
                  <TenantSelect
                    id="pay-tenant"
                    value={field.value || undefined}
                    onChange={(v) => field.onChange(v ?? '')}
                  />
                )}
              />
            </Field>
            <Field id="pay-amount" label={t('amountXof')} required error={errors.amount?.message}>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <InputNumber
                    {...a11y('pay-amount', errors.amount)}
                    style={{ width: 240 }}
                    min={1}
                    precision={0}
                    step={1000}
                    controls={false}
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v === null ? undefined : Number(v))}
                    onBlur={field.onBlur}
                    suffix="FCFA"
                  />
                )}
              />
            </Field>
            <Field id="pay-date" label={t('paidAt')} required error={errors.paidAt?.message}>
              <Input
                {...a11y('pay-date', errors.paidAt)}
                type="date"
                max={today}
                style={{ width: 200 }}
                {...bind(form.register('paidAt'))}
              />
            </Field>
            <Field id="pay-method" label={tb('method.label')} required>
              <Controller
                control={form.control}
                name="method"
                render={({ field }) => (
                  <Radio.Group
                    id="pay-method"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    options={METHODS.map((m) => ({ value: m, label: methodLabel(m) }))}
                  />
                )}
              />
            </Field>
            <Field
              id="pay-reference"
              label={t('reference')}
              extra={t('referenceHint')}
              error={errors.reference?.message}
            >
              <Input
                {...a11y('pay-reference', errors.reference)}
                {...bind(form.register('reference'))}
              />
            </Field>
            <Form.Item label={t('attachment')} extra={t('attachmentHint')}>
              <Upload
                accept="image/jpeg,image/png,image/webp,application/pdf"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  void upload(file);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>{t('chooseFile')}</Button>
              </Upload>
              {fileName ? (
                <Typography.Text style={{ marginLeft: 8 }}>{fileName}</Typography.Text>
              ) : null}
              {uploadError ? (
                <Alert
                  type="error"
                  showIcon
                  message={uploadError}
                  role="alert"
                  style={{ marginTop: 8 }}
                />
              ) : null}
            </Form.Item>
            <Field id="pay-note" label={t('note')} error={errors.note?.message}>
              <Controller
                control={form.control}
                name="note"
                render={({ field }) => (
                  <Input.TextArea
                    {...a11y('pay-note', errors.note)}
                    rows={2}
                    maxLength={2000}
                    value={field.value ?? ''}
                    onChange={field.onChange}
                  />
                )}
              />
            </Field>
          </Card>

          <Card size="small" title={t('allocation')} style={{ maxWidth: 960, marginTop: 16 }}>
            {!tenantId ? (
              <Typography.Text type="secondary">{t('allocationNoTenant')}</Typography.Text>
            ) : (
              <Table<Invoice>
                size="small"
                rowKey="id"
                loading={invoicesQuery.isPending}
                pagination={false}
                dataSource={open}
                locale={{ emptyText: t('noOpenInvoice') }}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: t('invoice'), dataIndex: 'number' },
                  { title: t('dueDate'), dataIndex: 'dueDate', render: (d: string) => fmt.day(d) },
                  {
                    title: t('balance'),
                    dataIndex: 'balance',
                    align: 'right',
                    render: (b: number, i) => money(b, i.currency),
                  },
                  {
                    title: t('toAllocate'),
                    key: 'alloc',
                    render: (_: unknown, i) => (
                      <InputNumber
                        aria-label={`${t('toAllocate')} ${i.number}`}
                        min={0}
                        max={i.balance}
                        precision={0}
                        controls={false}
                        value={allocations[i.id] ?? 0}
                        onChange={(v) => setManual({ ...allocations, [i.id]: Number(v ?? 0) })}
                      />
                    ),
                  },
                ]}
              />
            )}
            <div style={{ marginTop: 12 }} aria-live="polite" data-testid="allocation-summary">
              <div>
                {t('allocated')} : <strong>{money(split.allocated)}</strong>
              </div>
              {split.overAllocated ? (
                <Alert
                  type="error"
                  showIcon
                  role="alert"
                  message={t('overAllocated')}
                  style={{ marginTop: 8 }}
                />
              ) : (
                <div>
                  {t('remainder')} :{' '}
                  <strong data-testid="remainder">{money(split.remainder)}</strong>
                </div>
              )}
              {split.credit > 0 ? (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 8 }}
                  message={t('creditNotice', { amount: money(split.credit) })}
                />
              ) : null}
              {manual ? (
                <Button type="link" onClick={() => setManual(null)} style={{ paddingLeft: 0 }}>
                  {t('autoAllocate')}
                </Button>
              ) : null}
            </div>
          </Card>

          {duplicate ? (
            <Alert
              type="error"
              showIcon
              role="alert"
              style={{ maxWidth: 960, marginTop: 16 }}
              message={t('duplicate')}
              description={
                duplicate.existingPaymentId ? (
                  <Link to={`/payments/${duplicate.existingPaymentId}`}>{t('duplicateLink')}</Link>
                ) : null
              }
            />
          ) : null}
          {formError ? (
            <Alert
              type="error"
              showIcon
              role="alert"
              message={formError}
              style={{ maxWidth: 960, marginTop: 16 }}
            />
          ) : null}
          <div style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={form.formState.isSubmitting}>
              {t('record')}
            </Button>{' '}
            <Button onClick={() => navigate('/payments')}>{tb('cancel')}</Button>
          </div>
        </Form>
      </form>
    </>
  );
}
