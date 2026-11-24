import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Result,
  Select,
  Skeleton,
  Space,
  Table,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../auth/useCan';
import { formatMoney } from '../settings/util';
import { formatDayLong, nightsBetween, post } from '../../reservations/api';
import { fdKeys, openPoliceForm, useCompanies } from './api';
import type { CheckoutPreview, CheckoutResult } from './api';
import { DEPOSIT_METHODS } from './PoliceFields';
import { blockerKey, checkoutAction } from './model';
import { useFdError } from './useFdError';

const { Text } = Typography;

interface Props {
  /** Stay id or reservation room id (a seeded in-house stay gets its stay row on first access). */
  stayRef: string | null;
  onClose: () => void;
  onDone?: () => void;
}

/**
 * Check-out (OP-23): nights due are posted, then lines summary, balance and blockers. A quick
 * payment settles the folio; otherwise the balance goes to a company account (NIF) or, with the
 * dedicated permission, the check-out is forced with a reason. Invoice issued and e-mailed here.
 */
export function CheckOutDrawer({ stayRef, onClose, onDone }: Props) {
  const { t } = useTranslation('frontDesk');
  return (
    <Drawer
      open={!!stayRef}
      onClose={onClose}
      width={760}
      destroyOnHidden
      title={t('checkout.title')}
    >
      {stayRef ? <CheckOutBody key={stayRef} stayRef={stayRef} onClose={onClose} onDone={onDone} /> : null}
    </Drawer>
  );
}

function CheckOutBody({
  stayRef,
  onClose,
  onDone,
}: {
  stayRef: string;
  onClose: () => void;
  onDone?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation('frontDesk');
  const { can, has } = useCan();
  const qc = useQueryClient();
  const toMessage = useFdError();
  const canPay = can('folio.pay');
  const canTransfer = canPay && has('city_ledger');
  const canOverride = can('front_desk.checkout_with_balance');

  const preview = useQuery({
    queryKey: fdKeys.checkout(stayRef),
    queryFn: () => post<CheckoutPreview>(`/front-desk/stays/${stayRef}/checkout-preview`),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const p = preview.data;
  const money = (n: number) => formatMoney(n, p?.currency ?? 'XOF');

  const [company, setCompany] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState('');
  const companies = useCompanies(companySearch, canTransfer);
  const chosenCompany = companies.data?.find((c) => c.id === company) ?? null;
  const [overrideReason, setOverrideReason] = useState('');
  const [early, setEarly] = useState(false);
  const [issue, setIssue] = useState(true);
  const [invoiceTo, setInvoiceTo] = useState<'guest' | 'company'>('guest');
  const [sendEmail, setSendEmail] = useState(false);
  const [notify, setNotify] = useState(true);
  const [payMethod, setPayMethod] = useState<(typeof DEPOSIT_METHODS)[number]>('CARD');
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payRef, setPayRef] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);

  useEffect(() => {
    if (p) setPayAmount(Math.max(p.balance, 0) || null);
  }, [p?.balance]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = useMutation({
    mutationFn: () => {
      const folio = p!.folios.find((f) => f.balance > 0);
      return post(
        `/folios/${folio!.id}/payments`,
        { method: payMethod, amount: payAmount, ...(payRef ? { reference: payRef } : {}) },
        { 'Idempotency-Key': crypto.randomUUID() },
      );
    },
    onSuccess: () => {
      setFailure(null);
      setPayRef('');
      void preview.refetch();
    },
    onError: (e) => setFailure(toMessage(e)),
  });

  const action = p
    ? checkoutAction(p, {
        companyId: company,
        companyHasNif: !!chosenCompany?.taxId,
        overrideReason,
        canOverride,
      })
    : 'blocked';
  const needsEarlyConfirm = !!p?.earlyDeparture && !early;

  const checkout = useMutation({
    mutationFn: () =>
      post<CheckoutResult>(`/front-desk/stays/${stayRef}/checkout`, {
        ...(action === 'transfer' && company ? { transferToCompanyId: company } : {}),
        ...(action === 'override' ? { overrideReason: overrideReason.trim() } : {}),
        earlyDeparture: !!p?.earlyDeparture && early,
        invoice: {
          issue,
          ...(issue && invoiceTo === 'company' && company
            ? { customer: { type: 'company', companyId: company } }
            : {}),
          sendEmail: issue && sendEmail,
        },
        notifyGuest: notify,
      }),
    onSuccess: (res) => {
      setResult(res);
      void qc.invalidateQueries({ queryKey: fdKeys.all });
      void qc.invalidateQueries({ queryKey: ['reservations'] });
      void qc.invalidateQueries({ queryKey: ['planning'] });
      onDone?.();
    },
    onError: (e) => {
      setFailure(toMessage(e));
      void preview.refetch();
    },
  });

  if (result)
    return (
      <Result
        status={result.warnings.length ? 'warning' : 'success'}
        title={t('checkout.done')}
        subTitle={
          <Space direction="vertical" size={2}>
            <Text>{t(`checkout.status.${result.reservationStatus}`, { defaultValue: result.reservationStatus })}</Text>
            {result.transferred ? (
              <Text>{t('checkout.transferred', { amount: money(result.transferred) })}</Text>
            ) : null}
            {result.invoices.map((i) => (
              <Text key={i.id}>{t('checkout.invoiceIssued', { number: i.number })}</Text>
            ))}
            {result.warnings.map((w) => (
              <Text key={w} type="warning">
                {w}
              </Text>
            ))}
          </Space>
        }
        extra={[
          can('front_desk.police_form') ? (
            <Button key="p" onClick={() => void openPoliceForm(result.stayId)}>
              {t('checkin.printPolice')}
            </Button>
          ) : null,
          <Button key="c" type="primary" onClick={onClose}>
            {t('close')}
          </Button>,
        ]}
      />
    );

  if (preview.isLoading) return <Skeleton active />;
  if (preview.isError || !p)
    return (
      <Alert
        type="error"
        showIcon
        message={toMessage(preview.error)}
        action={<Button onClick={() => void preview.refetch()}>{t('retry')}</Button>}
      />
    );

  const blockers = p.blockers.filter((b) => b.code !== 'NOT_IN_HOUSE');
  const due = p.balance > 0;
  const canConfirm = action !== 'blocked' && !needsEarlyConfirm;

  return (
    <Flex vertical gap={16}>
      {failure ? <Alert type="error" showIcon message={failure} role="alert" /> : null}
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label={t('fields.reservation')}>{p.reservationNumber}</Descriptions.Item>
        <Descriptions.Item label={t('fields.room')}>{p.roomNumber ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={t('fields.stay')} span={2}>
          {formatDayLong(p.arrival, i18n.language)} → {formatDayLong(p.departure, i18n.language)} (
          {t('nights', { count: nightsBetween(p.arrival, p.departure) })})
        </Descriptions.Item>
      </Descriptions>

      <Table
        size="small"
        pagination={false}
        rowKey="department"
        dataSource={p.summary}
        aria-label={t('checkout.summary')}
        columns={[
          { title: t('checkout.department'), dataIndex: 'department' },
          { title: t('checkout.amount'), dataIndex: 'amount', align: 'right', render: money },
        ]}
        summary={() => (
          <>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>{t('checkout.charges')}</Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                {money(p.chargesTotal)}
              </Table.Summary.Cell>
            </Table.Summary.Row>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>{t('checkout.payments')}</Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                {money(p.paymentsTotal)}
              </Table.Summary.Cell>
            </Table.Summary.Row>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>
                <strong>{t('checkout.balance')}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <strong data-testid="checkout-balance">{money(p.balance)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </>
        )}
      />

      {blockers.length ? (
        <Alert
          type="warning"
          showIcon
          message={t('checkout.blocked')}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {blockers.map((b) => (
                <li key={`${b.code}${b.folioId ?? ''}`}>
                  {t(blockerKey(b), {
                    amount: money(b.amount ?? 0),
                    count: b.count ?? 0,
                    defaultValue: b.message,
                  })}
                </li>
              ))}
            </ul>
          }
        />
      ) : (
        <Alert type="success" showIcon message={t('checkout.ready')} />
      )}

      {p.earlyDeparture ? (
        <Checkbox checked={early} onChange={(e) => setEarly(e.target.checked)}>
          {t('checkout.early', { date: formatDayLong(p.departure, i18n.language) })}
        </Checkbox>
      ) : null}

      {due && canPay ? (
        <>
          <Divider orientation="left" plain>
            {t('checkout.quickPay')}
          </Divider>
          <Flex gap={12} wrap align="flex-end">
            <Form.Item label={t('deposit.method')} style={{ marginBottom: 0, minWidth: 180 }}>
              <Select
                aria-label={t('deposit.method')}
                value={payMethod}
                onChange={setPayMethod}
                options={DEPOSIT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
              />
            </Form.Item>
            <Form.Item label={t('deposit.amount')} style={{ marginBottom: 0 }}>
              <InputNumber
                aria-label={t('deposit.amount')}
                min={1}
                max={p.balance}
                precision={0}
                value={payAmount}
                onChange={setPayAmount}
              />
            </Form.Item>
            <Form.Item label={t('deposit.reference')} style={{ marginBottom: 0 }}>
              <Input
                aria-label={t('deposit.reference')}
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
            </Form.Item>
            <Button
              loading={pay.isPending}
              disabled={!payAmount || payAmount <= 0}
              onClick={() => pay.mutate()}
            >
              {t('checkout.collect')}
            </Button>
          </Flex>
        </>
      ) : null}

      {due && canTransfer ? (
        <>
          <Divider orientation="left" plain>
            {t('checkout.transfer')}
          </Divider>
          <Select
            showSearch
            allowClear
            filterOption={false}
            aria-label={t('checkout.company')}
            placeholder={t('checkout.company')}
            style={{ width: '100%' }}
            value={company ?? undefined}
            onChange={(v) => setCompany(v ?? null)}
            onSearch={setCompanySearch}
            options={(companies.data ?? []).map((c) => ({
              value: c.id,
              label: `${c.name}${c.taxId ? ` — NIF ${c.taxId}` : ` — ${t('checkout.noNif')}`}`,
            }))}
          />
          {chosenCompany && !chosenCompany.taxId ? (
            <Alert type="error" showIcon message={t('checkout.nifRequired')} role="alert" />
          ) : null}
        </>
      ) : null}

      {blockers.length && canOverride ? (
        <>
          <Divider orientation="left" plain>
            {t('checkout.override')}
          </Divider>
          <Input
            aria-label={t('checkout.overrideReason')}
            placeholder={t('checkout.overrideReason')}
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            maxLength={300}
          />
        </>
      ) : null}

      <Divider orientation="left" plain>
        {t('checkout.invoice')}
      </Divider>
      <Flex vertical gap={6}>
        <Checkbox checked={issue} onChange={(e) => setIssue(e.target.checked)}>
          {t('checkout.issueInvoice')}
        </Checkbox>
        {issue && company ? (
          <Select
            aria-label={t('checkout.invoiceTo')}
            value={invoiceTo}
            onChange={setInvoiceTo}
            style={{ maxWidth: 260 }}
            options={[
              { value: 'guest', label: t('checkout.toGuest') },
              { value: 'company', label: t('checkout.toCompany') },
            ]}
          />
        ) : null}
        {issue ? (
          <Checkbox checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}>
            {t('checkout.emailInvoice')}
          </Checkbox>
        ) : null}
        <Checkbox checked={notify} onChange={(e) => setNotify(e.target.checked)}>
          {t('checkout.sendThanks')}
        </Checkbox>
      </Flex>

      <Flex justify="flex-end" gap={8}>
        <Button onClick={onClose}>{t('close')}</Button>
        <Button
          type="primary"
          danger={action === 'override'}
          loading={checkout.isPending}
          disabled={!canConfirm}
          onClick={() => {
            setFailure(null);
            checkout.mutate();
          }}
        >
          {t(`checkout.confirm.${action}`)}
        </Button>
      </Flex>
    </Flex>
  );
}
