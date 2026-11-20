import { UploadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Col, ColorPicker, Flex, Row, Skeleton, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiClient } from '../../auth/session';
import { useApiError } from '../../auth/useApiError';
import { uploadAsset, type BrandingView } from '../../pages/settings/branding/api';
import { contrastWithWhite, propertyKey, type PropertyDto, type StepProps } from './common';

const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK = { primary: '#7a5a14', secondary: '#1f2a37' };

/** Step 7: logo upload and brand colours with a live preview. */
export function BrandingStep({ propertyId, saveRef }: StepProps) {
  const { t } = useTranslation('onboarding');
  const message = useApiError();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [primary, setPrimary] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: () => apiClient.get<BrandingView>('/branding'),
  });
  const property = useQuery({
    queryKey: propertyKey(propertyId),
    queryFn: () => apiClient.get<PropertyDto>(`/lodging/properties/${propertyId}`),
  });

  const p =
    primary ??
    branding.data?.primaryColor ??
    branding.data?.defaults.primaryColor ??
    FALLBACK.primary;
  const s =
    secondary ??
    branding.data?.secondaryColor ??
    branding.data?.defaults.secondaryColor ??
    FALLBACK.secondary;
  const colors = useRef({ p, s, touched: false });
  colors.current = { p, s, touched: primary !== null || secondary !== null };

  useEffect(() => {
    saveRef.current = async () => {
      const c = colors.current;
      if (!c.touched) return true;
      setError(null);
      try {
        await apiClient.put('/branding', {
          ...(HEX.test(c.p) ? { primaryColor: c.p.toLowerCase() } : {}),
          ...(HEX.test(c.s) ? { secondaryColor: c.s.toLowerCase() } : {}),
        });
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['branding'] }),
          qc.invalidateQueries({ queryKey: ['tenant-branding'] }),
        ]);
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      }
    };
    return () => {
      saveRef.current = null;
    };
  }, [saveRef, qc, message]);

  async function onFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadAsset('logo', file);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['branding'] }),
        qc.invalidateQueries({ queryKey: ['tenant-branding'] }),
      ]);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : message(e));
    } finally {
      setUploading(false);
    }
  }

  if (branding.isLoading) return <Skeleton active />;
  const logo = branding.data?.assets.logo?.url;
  const lowContrast = contrastWithWhite(p) < 4.5;
  const hotel = property.data?.name ?? '';

  return (
    <>
      {error ? (
        <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      ) : null}
      <Row gutter={[24, 24]}>
        <Col xs={24} md={12}>
          <Typography.Text strong>{t('branding.logo')}</Typography.Text>
          <Flex align="center" gap={12} style={{ margin: '8px 0 20px' }}>
            {logo ? (
              <img
                src={logo}
                alt={t('branding.logo')}
                style={{ height: 48, maxWidth: 160, objectFit: 'contain' }}
              />
            ) : null}
            <input
              ref={input}
              type="file"
              hidden
              data-testid="logo-input"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onFile(f);
              }}
            />
            <Button
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={() => input.current?.click()}
            >
              {logo ? t('branding.replace') : t('branding.upload')}
            </Button>
          </Flex>
          <Typography.Paragraph type="secondary">{t('branding.uploadHint')}</Typography.Paragraph>
          <Flex gap={24} wrap="wrap">
            <div>
              <Typography.Text id="primary-label" style={{ display: 'block', marginBottom: 4 }}>
                {t('branding.primary')}
              </Typography.Text>
              <ColorPicker
                aria-labelledby="primary-label"
                value={p}
                disabledAlpha
                showText
                onChange={(c) => setPrimary(c.toHexString())}
              />
            </div>
            <div>
              <Typography.Text id="secondary-label" style={{ display: 'block', marginBottom: 4 }}>
                {t('branding.secondary')}
              </Typography.Text>
              <ColorPicker
                aria-labelledby="secondary-label"
                value={s}
                disabledAlpha
                showText
                onChange={(c) => setSecondary(c.toHexString())}
              />
            </div>
          </Flex>
          {lowContrast ? (
            <Alert
              type="warning"
              showIcon
              message={t('branding.contrast')}
              style={{ marginTop: 16 }}
            />
          ) : null}
        </Col>
        <Col xs={24} md={12}>
          <Typography.Text strong>{t('branding.preview')}</Typography.Text>
          <div
            data-testid="brand-preview"
            style={{
              marginTop: 8,
              border: '1px solid rgba(128,128,128,.3)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <Flex
              align="center"
              gap={10}
              style={{ background: p, color: '#fff', padding: '12px 16px', minHeight: 56 }}
            >
              {logo ? (
                <img
                  src={logo}
                  alt=""
                  style={{ height: 32, background: '#fff', borderRadius: 4, padding: 2 }}
                />
              ) : null}
              <strong>{hotel}</strong>
            </Flex>
            <div style={{ padding: 16 }}>
              <Typography.Title level={4} style={{ marginTop: 0, color: s }}>
                {t('branding.previewHeading')}
              </Typography.Title>
              <button
                type="button"
                tabIndex={-1}
                style={{
                  background: p,
                  color: '#fff',
                  border: 0,
                  borderRadius: 6,
                  padding: '8px 18px',
                  fontWeight: 600,
                }}
              >
                {t('branding.previewButton')}
              </button>
              <div
                style={{ height: 6, background: s, borderRadius: 3, marginTop: 16, width: '40%' }}
              />
            </div>
          </div>
        </Col>
      </Row>
    </>
  );
}
