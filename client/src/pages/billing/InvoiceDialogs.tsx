import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { useCompanies } from '../front-desk/api';
import { bkKeys, openDocument, post } from './api';
import type { Folio, Invoice } from './api';
import { money, previewByRate } from './model';

const { Text } = Typography;

/** E-mails the invoice (PDF attached) to the customer; returns the address it went to. */
export function useEmailInvoice() {
  return useMutation({
    mutationFn: (v: { id: string; email?: string }) =>
      post<{ sent: boolean; to: string | null }>(
        `/invoices/${v.id}/email`,
        v.email ? { email: v.email } : {},
      ),
  });
}

/**
 * "Facturer": customer (guest or company with NIF), preview of the totals per tax rate, then
 * issue; the result offers the PDF and an e-mail. Company without NIF is warned about, not blocked
 * (the server decides what a missing NIF means for the fiscal provider).
 */
export function InvoiceDialog({
  folio,
  open,
  onClose,
  guestName,
}: {
  folio: Folio;
  open: boolean;
  onClose: () => void;
  guestName?: string | undefined;
}) {
  const { t } = useTranslation('billing');
  const { can } = useCan();
  const toMessage = useApiError();
  const qc = useQueryClient();
  const [to, setTo] = useState<'guest' | 'company'>('guest');
  const [company, setCompany] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [issued, setIssued] = useState<Invoice | null>(null);
  const companies = useCompanies(search, open && to === 'company');
  const chosen = companies.data?.find((c) => c.id === company) ?? null;
  const email = useEmailInvoice();
  const rows = previewByRate(folio.taxBreakdown.rows);
  const cur = folio.currency;

  const issue = useMutation({
    mutationFn: () =>
      post<Invoice>('/invoices', {
        folioId: folio.id,
        ...(to === 'company' && company
          ? { customer: { type: 'company', companyId: company } }
          : {}),
        sendEmail,
      }),
    onSuccess: (inv) => {
      setIssued(inv);
      setFailure(null);
      void qc.invalidateQueries({ queryKey: bkKeys.all });
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('invoice.title', { folio: folio.number })}
      destroyOnHidden
      footer={
        issued ? (
          <Button type="primary" onClick={onClose}>
            {t('close')}
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <Button
              type="primary"
              loading={issue.isPending}
              disabled={!can('invoices.issue') || (to === 'company' && !company)}
              onClick={() => issue.mutate()}
            >
              {t('invoice.issue')}
            </Button>
          </Space>
        )
      }
    >
      {issued ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type="success"
            showIcon
            message={t('invoice.issued', { number: issued.number })}
            description={money(issued.total, issued.currency)}
          />
          <Space>
            <Button onClick={() => void openDocument(`/invoices/${issued.id}/pdf`)}>
              {t('invoice.pdf')}
            </Button>
            <Button
              loading={email.isPending}
              onClick={() => email.mutate({ id: issued.id })}
              disabled={!(issued.customer.email ?? '')}
            >
              {t('invoice.sendEmail')}
            </Button>
          </Space>
          {email.isSuccess ? (
            <Text type="success">{t('invoice.emailSent', { to: email.data.to ?? '' })}</Text>
          ) : null}
          {email.isError ? <Text type="danger">{toMessage(email.error)}</Text> : null}
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Radio.Group
            value={to}
            onChange={(e) => setTo(e.target.value as 'guest' | 'company')}
            options={[
              {
                value: 'guest',
                label: guestName
                  ? t('invoice.toGuestNamed', { name: guestName })
                  : t('invoice.toGuest'),
              },
              { value: 'company', label: t('invoice.toCompany') },
            ]}
          />
          {to === 'company' ? (
            <>
              <Select
                showSearch
                filterOption={false}
                onSearch={setSearch}
                value={company ?? undefined}
                onChange={setCompany}
                aria-label={t('invoice.company')}
                placeholder={t('invoice.company')}
                style={{ width: '100%' }}
                options={(companies.data ?? []).map((c) => ({
                  value: c.id,
                  label: c.taxId ? `${c.name} - NIF ${c.taxId}` : c.name,
                }))}
              />
              {chosen && !chosen.taxId ? (
                <Alert type="warning" showIcon message={t('invoice.noNif')} />
              ) : null}
              {chosen?.taxId ? <Text type="secondary">NIF {chosen.taxId}</Text> : null}
            </>
          ) : null}
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            dataSource={rows}
            columns={[
              { title: t('invoice.rate'), dataIndex: 'label' },
              {
                title: t('invoice.base'),
                dataIndex: 'base',
                align: 'right',
                render: (v: number) => money(v, cur),
              },
              {
                title: t('invoice.tax'),
                dataIndex: 'amount',
                align: 'right',
                render: (v: number) => money(v, cur),
              },
            ]}
            summary={() => (
              <Table.Summary>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <Text strong>{t('invoice.net')}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    {money(folio.taxBreakdown.net, cur)}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                </Table.Summary.Row>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <Text strong>{t('invoice.total')}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong>{money(folio.taxBreakdown.total, cur)}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} />
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
          <Checkbox checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}>
            {t('invoice.sendOnIssue')}
          </Checkbox>
          {failure ? <Alert type="error" showIcon message={failure} /> : null}
        </Space>
      )}
    </Modal>
  );
}

/** Credit note: full, or a selection of the invoice's charges (with their taxes and discounts). Needs `invoices.credit_note`. */
export function CreditNoteDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onDone?: (note: Invoice) => void;
}) {
  const { t } = useTranslation('billing');
  const toMessage = useApiError();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const lines = invoice?.totals.lines ?? [];

  const create = useMutation({
    mutationFn: () =>
      post<Invoice>(`/invoices/${invoice!.id}/credit-notes`, {
        ...(mode === 'partial' ? { lineIds: selected } : {}),
        reason: reason.trim(),
      }),
    onSuccess: (note) => {
      void qc.invalidateQueries({ queryKey: bkKeys.all });
      onDone?.(note);
      onClose();
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  const ready = reason.trim().length >= 3 && (mode === 'full' || selected.length > 0);
  return (
    <Modal
      open={!!invoice}
      onCancel={onClose}
      destroyOnHidden
      title={t('creditNote.title', { number: invoice?.number ?? '' })}
      okText={t('creditNote.create')}
      cancelText={t('cancel')}
      okButtonProps={{ disabled: !ready, loading: create.isPending }}
      onOk={() => create.mutate()}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label={t('invoices.customer')}>
            {invoice?.customer.name}
          </Descriptions.Item>
          <Descriptions.Item label={t('invoices.total')}>
            {invoice ? money(invoice.total, invoice.currency) : ''}
          </Descriptions.Item>
        </Descriptions>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value as 'full' | 'partial')}
          options={[
            { value: 'full', label: t('creditNote.full') },
            { value: 'partial', label: t('creditNote.partial'), disabled: lines.length === 0 },
          ]}
        />
        {mode === 'partial' ? (
          <Table
            size="small"
            pagination={false}
            rowKey="lineId"
            dataSource={lines}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            columns={[
              { title: t('folio.label'), dataIndex: 'description' },
              {
                title: t('folio.amount'),
                dataIndex: 'net',
                align: 'right',
                render: (v: number) => money(v, invoice?.currency),
              },
            ]}
          />
        ) : null}
        <Input.TextArea
          aria-label={t('reason')}
          placeholder={t('reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          rows={2}
        />
        {failure ? <Alert type="error" showIcon message={failure} /> : null}
      </Space>
    </Modal>
  );
}
