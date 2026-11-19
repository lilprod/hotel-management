import { CopyOutlined, UploadOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { Field, a11y, bind } from '../../components/Field';
import { METHODS, money, todayIso, useFormatDate } from '../../billing/common';
import type { PaymentInstructions, TenantDeclaration } from '../../billing/common';

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export const declarationSchema = z.object({
  method: z.enum(METHODS, 'subscription:validation.method'),
  amount: z
    .number('subscription:validation.amount')
    .int('subscription:validation.amount')
    .positive('subscription:validation.amount')
    .max(Number.MAX_SAFE_INTEGER, 'subscription:validation.amount'),
  paidAt: z
    .string()
    .min(1, 'subscription:validation.paidAt')
    .refine((d) => d <= todayIso(), 'subscription:validation.paidAtFuture'),
  reference: z.string().trim().max(100, 'subscription:validation.referenceMax').optional(),
  note: z.string().max(2000).optional(),
});
type Values = z.infer<typeof declarationSchema>;

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation('subscription');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      type="text"
      icon={<CopyOutlined />}
      aria-label={`${t('instructions.copy')} ${label}`}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // clipboard unavailable: the value stays selectable on screen
          }
        })();
      }}
    >
      {copied ? t('instructions.copied') : t('instructions.copy')}
    </Button>
  );
}

/** TN-34: how to pay (merchant numbers, amount due, reference to quote). */
function InstructionsCard({ data }: { data: PaymentInstructions }) {
  const { t } = useTranslation('subscription');
  const reference = data.invoices[0]?.number ?? '';
  const methods = data.methods.filter((m) => m.merchantNumber);
  return (
    <Card title={t('instructions.title')} style={{ height: '100%' }}>
      <Typography.Paragraph type="secondary">
        {t('instructions.payee', { name: data.payee })}
      </Typography.Paragraph>
      <div style={{ marginBottom: 12 }}>
        <div>{t('instructions.amountDue')}</div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {data.amountDue > 0 ? money(data.amountDue, data.currency) : t('instructions.nothingDue')}
        </Typography.Title>
      </div>
      {methods.length === 0 ? (
        <Alert type="info" showIcon message={t('instructions.noMethods')} />
      ) : null}
      {methods.map((m) => (
        <div key={m.code} style={{ marginBottom: 8 }}>
          <strong>{m.label}</strong>
          <div>
            {t('instructions.merchantNumber')} :{' '}
            <Typography.Text strong code>
              {m.merchantNumber}
            </Typography.Text>
            <CopyButton value={m.merchantNumber!} label={m.label} />
          </div>
        </div>
      ))}
      {reference ? (
        <div style={{ marginTop: 12 }}>
          {t('instructions.reference')} :{' '}
          <Typography.Text strong code>
            {reference}
          </Typography.Text>
          <CopyButton value={reference} label={t('instructions.reference')} />
        </div>
      ) : null}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t('instructions.referenceHint')} {t('instructions.then')}
      </Typography.Paragraph>
    </Card>
  );
}

/** TN-31: declare a payment (method, amount, date ≤ today, reference, screenshot). */
export function DeclarationForm({
  instructions,
}: {
  instructions: PaymentInstructions | undefined;
}) {
  const { t } = useTranslation('subscription');
  const message = useApiError();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(declarationSchema) as unknown as Resolver<Values>,
    defaultValues: {
      method: instructions?.methods[0]?.code ?? 'MIXX',
      ...(instructions && instructions.amountDue > 0 ? { amount: instructions.amountDue } : {}),
      paidAt: todayIso(),
      reference: '',
      note: '',
    },
  });
  const { errors } = form.formState;

  const submit = useMutation({
    mutationFn: async (v: Values) => {
      let attachmentFileId: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        attachmentFileId = (
          await apiClient.post<{ fileId: string }>('/billing/declarations/attachments', fd)
        ).fileId;
      }
      return apiClient.post('/billing/declarations', {
        method: v.method,
        amount: v.amount,
        ...(instructions ? { currency: instructions.currency } : {}),
        paidAt: v.paidAt,
        ...(v.reference ? { reference: v.reference } : {}),
        ...(v.note ? { note: v.note } : {}),
        ...(attachmentFileId ? { attachmentFileId } : {}),
      });
    },
    onSuccess: async () => {
      setSent(true);
      setFile(null);
      form.reset({ ...form.getValues(), reference: '', note: '' });
      await qc.invalidateQueries({ queryKey: ['billing', 'declarations'] });
    },
  });

  const pick = (f: File) => {
    setFileError(null);
    if (!PROOF_TYPES.includes(f.type)) setFileError(t('validation.fileType'));
    else if (f.size > PROOF_MAX_BYTES) setFileError(t('validation.fileSize'));
    else setFile(f);
  };

  return (
    <Card title={t('declare.title')} style={{ height: '100%' }}>
      <form
        noValidate
        onSubmit={(e) => {
          setSent(false);
          void form.handleSubmit((v) => submit.mutate(v))(e);
        }}
      >
        <Field id="decl-method" label={t('declare.method')} required error={errors.method?.message}>
          <Controller
            control={form.control}
            name="method"
            render={({ field }) => (
              <Select
                {...field}
                id="decl-method"
                options={METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))}
              />
            )}
          />
        </Field>
        <Field id="decl-amount" label={t('declare.amount')} required error={errors.amount?.message}>
          <Controller
            control={form.control}
            name="amount"
            render={({ field }) => (
              <InputNumber
                id="decl-amount"
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? 'decl-amount-error' : undefined}
                style={{ width: '100%' }}
                min={0}
                precision={0}
                value={field.value ?? null}
                onChange={(v) => field.onChange(v)}
                onBlur={field.onBlur}
                suffix={instructions?.currency ?? 'XOF'}
              />
            )}
          />
        </Field>
        <Field
          id="decl-paid-at"
          label={t('declare.paidAt')}
          required
          error={errors.paidAt?.message}
        >
          <Input
            type="date"
            max={todayIso()}
            {...a11y('decl-paid-at', errors.paidAt)}
            {...bind(form.register('paidAt'))}
          />
        </Field>
        <Field
          id="decl-reference"
          label={t('declare.reference')}
          extra={t('declare.referenceHint')}
          error={errors.reference?.message}
        >
          <Input
            {...a11y('decl-reference', errors.reference)}
            {...bind(form.register('reference'))}
          />
        </Field>
        <Field id="decl-note" label={t('declare.note')} error={errors.note?.message}>
          <Input.TextArea rows={2} {...a11y('decl-note', errors.note)} {...form.register('note')} />
        </Field>
        <Field id="decl-file" label={t('declare.screenshot')} extra={t('declare.screenshotHint')}>
          <Upload
            accept={PROOF_TYPES.join(',')}
            maxCount={1}
            showUploadList={false}
            beforeUpload={(f) => {
              pick(f);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />}>{t('declare.choose')}</Button>
          </Upload>
          {file ? (
            <span style={{ marginLeft: 8 }}>
              {file.name}{' '}
              <Button size="small" type="link" onClick={() => setFile(null)}>
                {t('declare.remove')}
              </Button>
            </span>
          ) : null}
          {fileError ? (
            <Alert
              style={{ marginTop: 8 }}
              type="error"
              showIcon
              role="alert"
              message={fileError}
            />
          ) : null}
        </Field>
        {submit.isError ? (
          <Alert
            type="error"
            showIcon
            role="alert"
            message={message(submit.error)}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {sent ? (
          <Alert
            type="success"
            showIcon
            role="status"
            message={t('declare.sent')}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Button type="primary" htmlType="submit" loading={submit.isPending}>
          {t('declare.submit')}
        </Button>
      </form>
    </Card>
  );
}

const DECL_COLORS = { SUBMITTED: 'gold', APPROVED: 'green', REJECTED: 'red' } as const;

function DeclarationsHistory() {
  const { t } = useTranslation('subscription');
  const fmt = useFormatDate();
  const q = useQuery({
    queryKey: ['billing', 'declarations'],
    queryFn: () => apiClient.get<{ items: TenantDeclaration[] }>('/billing/declarations'),
  });
  return (
    <Card title={t('history.title')}>
      <Table<TenantDeclaration>
        size="small"
        rowKey="id"
        loading={q.isPending}
        dataSource={q.data?.items ?? []}
        locale={{ emptyText: t('history.empty') }}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: t('history.date'), dataIndex: 'createdAt', render: (d: string) => fmt.day(d) },
          { title: t('history.paidAt'), dataIndex: 'paidAt', render: (d: string) => fmt.day(d) },
          {
            title: t('history.amount'),
            dataIndex: 'amount',
            align: 'right',
            render: (v: number, r) => money(v, r.currency),
          },
          {
            title: t('history.method'),
            dataIndex: 'method',
            render: (m: string) => t(`method.${m}`, { defaultValue: m }),
          },
          {
            title: t('history.reference'),
            dataIndex: 'reference',
            render: (r: string | null) => r ?? '—',
          },
          {
            title: t('history.status'),
            render: (_: unknown, r) => (
              <>
                <Tag color={DECL_COLORS[r.status]}>{t(`declStatus.${r.status}`)}</Tag>
                {r.status === 'REJECTED' && r.rejectReason ? (
                  <div>
                    <Typography.Text type="danger">
                      {t('history.reason')} : {r.rejectReason}
                    </Typography.Text>
                  </div>
                ) : null}
              </>
            ),
          },
        ]}
      />
    </Card>
  );
}

/** Payment instructions, declaration form and declarations history. */
export function PaymentSection() {
  const message = useApiError();
  const q = useQuery({
    queryKey: ['billing', 'payment-instructions'],
    queryFn: () => apiClient.get<PaymentInstructions>('/billing/payment-instructions'),
  });
  return (
    <>
      {q.isError ? <Alert type="error" showIcon message={message(q.error)} /> : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          {q.data ? <InstructionsCard data={q.data} /> : null}
        </Col>
        <Col xs={24} lg={12}>
          {/* mounted once the amount due is known, so it can pre-fill the form */}
          {q.isSuccess ? <DeclarationForm instructions={q.data} /> : null}
        </Col>
      </Row>
      <DeclarationsHistory />
    </>
  );
}
