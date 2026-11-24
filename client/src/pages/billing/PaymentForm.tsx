import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Form, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ApiError } from '@hm/ui';

import { useApiError } from '../../auth/useApiError';
import { useCan } from '../../auth/useCan';
import { useCompanies } from '../front-desk/api';
import { PAY_METHODS, bkKeys, get, post, qs } from './api';
import type { ExchangeRate, Folio, PayMethod, PaymentResult } from './api';
import { fromMinor, money, tenderSummary, toMinor } from './model';

const { Text } = Typography;

/** Latest known rate `base -> quote` (the API enforces the real business-date rule and max age). */
export function latestRate(rates: readonly ExchangeRate[], base: string, quote: string): ExchangeRate | null {
  return (
    [...rates]
      .filter((r) => r.base === base && r.quote === quote)
      .sort((a, b) => b.validOn.localeCompare(a.validOn))[0] ?? null
  );
}

interface Props {
  folio: Folio;
  onPaid: (result: PaymentResult) => void;
}

/**
 * "Encaisser" (OP-91): method, amount (default = balance), optional reference (unique per method),
 * tender in a foreign currency with the rate and the change shown live. One Idempotency-Key per
 * attempt: a retried submit never records the payment twice.
 */
export function PaymentForm({ folio, onPaid }: Props) {
  const { t } = useTranslation('billing');
  const { has } = useCan();
  const toMessage = useApiError();
  const cur = folio.currency;
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [amount, setAmount] = useState<number | null>(folio.balance > 0 ? fromMinor(folio.balance, cur) : null);
  const [reference, setReference] = useState('');
  const [tenderCur, setTenderCur] = useState(cur);
  const [tendered, setTendered] = useState<number | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState('');
  const [fieldError, setFieldError] = useState<{ reference?: string; tender?: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  const key = useRef(crypto.randomUUID());

  const methods = PAY_METHODS.filter((m) => m !== 'CITY_LEDGER' || has('city_ledger'));
  const rates = useQuery({
    queryKey: bkKeys.rates,
    queryFn: () => get<{ items: ExchangeRate[] }>(`/exchange-rates${qs({ quote: cur, limit: 200 })}`),
    staleTime: 60_000,
  });
  const foreign = useMemo(
    () => [...new Set((rates.data?.items ?? []).filter((r) => r.quote === cur).map((r) => r.base))],
    [rates.data, cur],
  );
  const rate = tenderCur === cur ? null : latestRate(rates.data?.items ?? [], tenderCur, cur);
  const companies = useCompanies(companySearch, method === 'CITY_LEDGER');

  const amountMinor = toMinor(amount, cur);
  const tenderMinor = tenderCur === cur ? null : toMinor(tendered, tenderCur);
  const sum = tenderSummary({
    balance: folio.balance,
    amount: amountMinor,
    tendered: tenderMinor,
    rate: rate?.rate ?? null,
    from: tenderCur,
    to: cur,
  });
  const cashOnly = method === 'CASH';

  // a changed payment is a new attempt: new Idempotency-Key (a plain retry keeps the same one)
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [method, amount, reference, tenderCur, tendered, company]);

  const pay = useMutation({
    mutationFn: () =>
      post<PaymentResult>(
        `/folios/${folio.id}/payments`,
        {
          method,
          ...(amountMinor !== null && method !== 'CITY_LEDGER' ? { amount: amountMinor } : {}),
          ...(method === 'CITY_LEDGER' && company ? { companyId: company } : {}),
          ...(tenderMinor !== null ? { tenderedCurrency: tenderCur, tenderedAmount: tenderMinor } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
        { 'Idempotency-Key': key.current },
      ),
    onSuccess: (res) => {
      setFailure(null);
      setFieldError(null);
      setReference('');
      setTendered(null);
      onPaid(res);
    },
    onError: (e) => {
      setFailure(null);
      setFieldError(null);
      setNoSession(false);
      if (e instanceof ApiError && e.reason === 'DUPLICATE_REFERENCE') {
        setFieldError({ reference: t('pay.errors.DUPLICATE_REFERENCE') });
      } else if (e instanceof ApiError && e.errors.some((x) => x.path.includes('reference'))) {
        setFieldError({ reference: t('pay.errors.REFERENCE_FORMAT') });
      } else if (e instanceof ApiError && e.reason === 'NO_OPEN_CASH_SESSION') {
        setNoSession(true);
      } else if (e instanceof ApiError && e.errors.some((x) => x.code === 'TENDER_TOO_LOW')) {
        setFieldError({ tender: t('pay.errors.TENDER_TOO_LOW') });
      } else {
        setFailure(toMessage(e));
      }
      // a failed attempt may have been recorded: keep the key until the form changes
    },
  });

  const invalid =
    folio.status !== 'OPEN' ||
    (method === 'CITY_LEDGER' ? !company : amountMinor === null && sum === null) ||
    (tenderCur !== cur && (tenderMinor === null || !rate));

  return (
    <Form
      layout="vertical"
      onFinish={() => pay.mutate()}
      aria-label={t('pay.title')}
    >
      <Form.Item label={t('pay.method')}>
        <Radio.Group
          value={method}
          onChange={(e) => {
            setMethod(e.target.value as PayMethod);
            if (e.target.value !== 'CASH' && tenderCur !== cur) setTenderCur(cur);
          }}
          optionType="button"
          buttonStyle="solid"
          options={methods.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
        />
      </Form.Item>
      {method === 'CITY_LEDGER' ? (
        <Form.Item label={t('pay.company')} required>
          <Select
            showSearch
            filterOption={false}
            onSearch={setCompanySearch}
            value={company ?? undefined}
            onChange={setCompany}
            aria-label={t('pay.company')}
            options={(companies.data ?? []).map((c) => ({
              value: c.id,
              label: c.taxId ? `${c.name} (NIF ${c.taxId})` : c.name,
            }))}
          />
        </Form.Item>
      ) : (
        <Form.Item label={t('pay.amount', { currency: cur })}>
          <InputNumber
            aria-label={t('pay.amount', { currency: cur })}
            min={0}
            style={{ width: '100%' }}
            value={amount}
            onChange={setAmount}
            precision={cur === 'XOF' ? 0 : 2}
          />
        </Form.Item>
      )}
      {cashOnly && method !== 'CITY_LEDGER' && foreign.length > 0 ? (
        <Space align="start" wrap>
          <Form.Item label={t('pay.tenderCurrency')}>
            <Select
              aria-label={t('pay.tenderCurrency')}
              value={tenderCur}
              onChange={(v) => {
                setTenderCur(v);
                setTendered(null);
              }}
              style={{ width: 120 }}
              options={[cur, ...foreign].map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          {tenderCur !== cur ? (
            <Form.Item
              label={t('pay.tendered', { currency: tenderCur })}
              validateStatus={fieldError?.tender ? 'error' : undefined}
              help={fieldError?.tender}
            >
              <InputNumber
                aria-label={t('pay.tendered', { currency: tenderCur })}
                min={0}
                value={tendered}
                onChange={setTendered}
                precision={2}
                style={{ width: 180 }}
              />
            </Form.Item>
          ) : null}
        </Space>
      ) : null}
      {tenderCur !== cur ? (
        <Space direction="vertical" size={2} style={{ marginBottom: 12 }}>
          {rate ? (
            <Text type="secondary">{t('pay.rate', { base: tenderCur, rate: rate.rate, quote: cur, date: rate.validOn })}</Text>
          ) : (
            <Text type="danger">{t('pay.noRate', { currency: tenderCur })}</Text>
          )}
          {sum ? (
            <>
              <Text data-testid="converted">{t('pay.converted', { amount: money(sum.converted, cur) })}</Text>
              <Text strong data-testid="change">
                {t('pay.change', { amount: money(sum.change, cur) })}
              </Text>
            </>
          ) : null}
        </Space>
      ) : null}
      <Form.Item
        label={t('pay.reference')}
        validateStatus={fieldError?.reference ? 'error' : undefined}
        help={fieldError?.reference}
      >
        <Input
          aria-label={t('pay.reference')}
          value={reference}
          onChange={(e) => {
            setReference(e.target.value);
            setFieldError(null);
          }}
          maxLength={100}
          placeholder={t('pay.referenceHint')}
        />
      </Form.Item>
      {noSession ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('pay.errors.NO_OPEN_CASH_SESSION')}
          action={<Link to="/cash">{t('pay.openCash')}</Link>}
        />
      ) : null}
      {failure ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={failure} /> : null}
      <Button type="primary" htmlType="submit" loading={pay.isPending} disabled={invalid || (sum?.tooLow ?? false)}>
        {t('pay.submit')}
      </Button>
    </Form>
  );
}
