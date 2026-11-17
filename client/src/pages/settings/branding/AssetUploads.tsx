import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, List, Popconfirm } from 'antd';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ASSET_KINDS, ApiError, api, uploadAsset, type AssetKind, type BrandingView } from './api';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/x-icon';

/** Logo (light/dark), favicon, login background and signature/stamp uploads. */
export function AssetUploads({ assets }: { assets: BrandingView['assets'] }) {
  const { t } = useTranslation('branding');
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const kind = useRef<AssetKind>('logo');
  const [busy, setBusy] = useState<AssetKind | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['branding'] });
  const up = useMutation({
    mutationFn: (v: { kind: AssetKind; file: File }) => uploadAsset(v.kind, v.file),
    onSuccess: () => {
      setError(null);
      return refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error')),
  });
  const del = useMutation({
    mutationFn: (k: AssetKind) => api('DELETE', `/branding/assets/${k}`),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof ApiError ? e.message : t('error')),
  });

  return (
    <Card size="small" title={t('assets.title')} style={{ marginTop: 16 }}>
      {error && <Alert role="alert" type="error" message={error} style={{ marginBottom: 12 }} />}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="asset-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) {
            setBusy(kind.current);
            up.mutate({ kind: kind.current, file });
          }
        }}
      />
      <List
        dataSource={[...ASSET_KINDS]}
        renderItem={(k) => (
          <List.Item
            actions={[
              <Button
                key="up"
                size="small"
                aria-label={`${t(assets[k] ? 'assets.replace' : 'assets.upload')} ${t(`assets.kinds.${k}`)}`}
                loading={up.isPending && busy === k}
                onClick={() => {
                  kind.current = k;
                  input.current?.click();
                }}
              >
                {t(assets[k] ? 'assets.replace' : 'assets.upload')}
              </Button>,
              assets[k] ? (
                <Popconfirm
                  key="rm"
                  title={t('assets.confirmRemove')}
                  onConfirm={() => del.mutate(k)}
                >
                  <Button size="small" danger>
                    {t('assets.remove')}
                  </Button>
                </Popconfirm>
              ) : null,
            ]}
          >
            <List.Item.Meta title={t(`assets.kinds.${k}`)} description={t(`assets.hints.${k}`)} />
            {assets[k] ? t('assets.set') : t('assets.unset')}
          </List.Item>
        )}
      />
    </Card>
  );
}
