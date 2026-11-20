import { CheckCircleFilled, MinusCircleOutlined } from '@ant-design/icons';
import { Alert, Card, Checkbox, List, Typography, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { checklistOf, type OnboardingView } from '../api';

/** Step 8: what was configured, plus the "load demonstration data" option (TN-03). */
export function RecapStep({
  view,
  wantDemo,
  onWantDemo,
  error,
}: {
  view: OnboardingView;
  wantDemo: boolean;
  onWantDemo: (v: boolean) => void;
  error: string | null;
}) {
  const { t } = useTranslation('onboarding');
  const { token } = theme.useToken();
  const done = checklistOf(view);
  const f = view.facts;
  const rows: { key: keyof typeof done; detail: string }[] = [
    { key: 'property', detail: '' },
    { key: 'roomTypes', detail: String(f.roomTypes) },
    { key: 'rooms', detail: String(f.rooms) },
    { key: 'rates', detail: String(f.rates) },
    { key: 'taxes', detail: String(f.taxes) },
    { key: 'team', detail: '' },
    { key: 'branding', detail: '' },
  ];
  return (
    <>
      <Typography.Paragraph type="secondary">{t('recap.text')}</Typography.Paragraph>
      <List
        bordered
        size="small"
        dataSource={rows}
        renderItem={(r) => (
          <List.Item
            extra={
              <span style={{ color: done[r.key] ? token.colorSuccess : token.colorTextTertiary }}>
                {done[r.key] ? (
                  <CheckCircleFilled aria-hidden />
                ) : (
                  <MinusCircleOutlined aria-hidden />
                )}{' '}
                {done[r.key] ? t('recap.done') : t('recap.todo')}
              </span>
            }
          >
            <strong>{t(`recap.${r.key}`)}</strong>
            {r.detail ? (
              <span style={{ marginLeft: 8, color: token.colorTextSecondary }}>{r.detail}</span>
            ) : null}
          </List.Item>
        )}
      />
      <Card size="small" style={{ marginTop: 16 }}>
        <Checkbox
          checked={wantDemo || view.demo.loaded}
          disabled={view.demo.loaded}
          onChange={(e) => onWantDemo(e.target.checked)}
        >
          <strong>{t('recap.demo')}</strong>
        </Checkbox>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0 24px' }}>
          {view.demo.loaded ? t('recap.demoLoaded') : t('recap.demoText')}
          {!view.demo.loaded ? ` ${t('recap.demoQuota')}` : ''}
        </Typography.Paragraph>
      </Card>
      {error ? (
        <Alert role="alert" type="error" showIcon message={error} style={{ marginTop: 16 }} />
      ) : null}
    </>
  );
}
