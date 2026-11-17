import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Form, Input, Row, Space, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { HmThemeProvider, contrastRatio, readableTextColor } from '@hm/ui';

import { AssetUploads } from './AssetUploads';
import { ApiError, api, type BrandingView } from './api';
import { brandingFormSchema, toPayload, type BrandingForm } from './schema';

const EMPTY: BrandingForm = {
  primaryColor: '#7a5a14',
  secondaryColor: '#1f2a37',
  docHeader: '',
  docFooter: '',
  legalMentions: '',
  emailSenderName: '',
  loginMessage: '',
  legal: { legalForm: '', nif: '', rccm: '', taxRegime: '', address: '' },
};

function fromView(v: BrandingView): BrandingForm {
  return {
    primaryColor: v.primaryColor ?? v.defaults.primaryColor,
    secondaryColor: v.secondaryColor ?? v.defaults.secondaryColor,
    docHeader: v.docHeader ?? '',
    docFooter: v.docFooter ?? '',
    legalMentions: v.legalMentions ?? '',
    emailSenderName: v.emailSenderName ?? '',
    loginMessage: v.loginMessage ?? '',
    legal: {
      legalForm: v.legal.legalForm ?? '',
      nif: v.legal.nif ?? '',
      rccm: v.legal.rccm ?? '',
      taxRegime: v.legal.taxRegime ?? '',
      address: v.legal.address ?? '',
    },
  };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Colours, document header/footer, legal mentions, sender name and login message. */
export function BrandingFormPanel() {
  const { t } = useTranslation('branding');
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ['branding'],
    queryFn: () => api<BrandingView>('GET', '/branding'),
  });
  const form = useForm<BrandingForm>({
    resolver: zodResolver(brandingFormSchema),
    defaultValues: EMPTY,
  });
  useEffect(() => {
    if (query.data) form.reset(fromView(query.data));
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: (v: BrandingForm) => api<BrandingView>('PUT', '/branding', toPayload(v)),
    onSuccess: async (data) => {
      setError(null);
      setSaved(true);
      qc.setQueryData(['branding'], data);
    },
    onError: (e) => {
      setSaved(false);
      setError(e instanceof ApiError ? e.message : t('error'));
    },
  });

  const [primary = EMPTY.primaryColor, secondary = EMPTY.secondaryColor] = useWatch({
    control: form.control,
    name: ['primaryColor', 'secondaryColor'],
  });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? t(`validation.${m}`, { defaultValue: m }) : undefined);
  const validPrimary = HEX.test(primary) ? primary : EMPTY.primaryColor;
  const validSecondary = HEX.test(secondary) ? secondary : EMPTY.secondaryColor;
  const onPrimary = readableTextColor(validPrimary);
  const ratio = contrastRatio(validPrimary, '#ffffff');
  const serverWarnings = query.data?.contrast.warnings ?? [];

  const text = (name: Exclude<keyof BrandingForm, 'legal'>, area = false) => (
    <Form.Item
      label={t(`f.${name}`)}
      validateStatus={errors[name] ? 'error' : undefined}
      help={msg(errors[name]?.message)}
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field }) =>
          area ? (
            <Input.TextArea rows={3} aria-label={t(`f.${name}`)} {...field} />
          ) : (
            <Input aria-label={t(`f.${name}`)} {...field} />
          )
        }
      />
    </Form.Item>
  );
  const legal = (name: keyof BrandingForm['legal']) => (
    <Form.Item label={t(`legal.${name}`)}>
      <Controller
        control={form.control}
        name={`legal.${name}`}
        render={({ field }) => <Input aria-label={t(`legal.${name}`)} {...field} />}
      />
    </Form.Item>
  );

  return (
    <Row gutter={24}>
      <Col xs={24} lg={14}>
        {query.isError && <Alert type="error" message={t('error')} style={{ marginBottom: 12 }} />}
        <Form layout="vertical" onFinish={form.handleSubmit((v) => save.mutate(v))}>
          <Row gutter={16}>
            <Col span={12}>{text('primaryColor')}</Col>
            <Col span={12}>{text('secondaryColor')}</Col>
          </Row>
          {ratio < 4.5 && (
            <Alert
              role="alert"
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={t('contrastWarning', { ratio: ratio.toFixed(2) })}
            />
          )}
          {serverWarnings.length > 0 && ratio >= 4.5 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={serverWarnings[0]?.message}
            />
          )}
          {text('emailSenderName')}
          {text('loginMessage', true)}
          {text('docHeader', true)}
          {text('docFooter', true)}
          <Card size="small" title={t('legal.title')} style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col span={12}>{legal('legalForm')}</Col>
              <Col span={12}>{legal('taxRegime')}</Col>
              <Col span={12}>{legal('nif')}</Col>
              <Col span={12}>{legal('rccm')}</Col>
              <Col span={24}>{legal('address')}</Col>
            </Row>
            <Space size={4} wrap>
              <span>{t('legal.regimeHint')}</span>
              {(query.data?.defaults.taxRegimes ?? ['RNI', 'RSI', 'TPU']).map((r) => (
                <Tag
                  key={r}
                  style={{ cursor: 'pointer' }}
                  onClick={() => form.setValue('legal.taxRegime', r, { shouldDirty: true })}
                >
                  {r}
                </Tag>
              ))}
            </Space>
          </Card>
          {text('legalMentions', true)}
          {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}
          {saved && !error && (
            <Alert type="success" message={t('saved')} style={{ marginBottom: 12 }} />
          )}
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {t('save')}
          </Button>
        </Form>
        <AssetUploads assets={query.data?.assets ?? {}} />
      </Col>
      <Col xs={24} lg={10}>
        <Card size="small" title={t('preview.title')} aria-label={t('preview.title')}>
          <HmThemeProvider
            branding={{
              name: query.data ? 'Hôtel' : '',
              primaryColor: validPrimary,
              secondaryColor: validSecondary,
              logoUrl: query.data?.assets.logo?.url ?? null,
            }}
          >
            <div
              data-testid="branding-preview"
              style={{ background: validSecondary, color: '#fff', padding: 12, borderRadius: 6 }}
            >
              {query.data?.assets.logo ? (
                <img src={query.data.assets.logo.url} alt="" height={32} />
              ) : (
                <strong>{t('preview.brand')}</strong>
              )}
            </div>
            <div style={{ padding: '12px 0' }}>
              <Button type="primary">{t('preview.button')}</Button>{' '}
              <Tag color={validPrimary} style={{ color: onPrimary }}>
                {t('preview.tag')}
              </Tag>
              <p>
                <a href="#preview" onClick={(e) => e.preventDefault()}>
                  {t('preview.link')}
                </a>
              </p>
            </div>
          </HmThemeProvider>
        </Card>
      </Col>
    </Row>
  );
}
