import { useQuery } from '@tanstack/react-query';
import { Button, Result, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { verifyEmail } from './api';
import { SignupLayout } from './SignupLayout';

/** Target of the e-mail link: activates the owner, then points to the tenant login. */
export function VerifyPage() {
  const { t } = useTranslation('signup');
  const [params] = useSearchParams();
  const token = params.get('token');
  const result = useQuery({
    queryKey: ['signup-verify', token],
    queryFn: () => verifyEmail(token ?? ''),
    enabled: !!token,
    retry: false,
    // A verification link is single use: never refetch it.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return (
    <SignupLayout>
      <div style={{ maxWidth: 560, margin: '48px auto 0' }}>
        {!token ? (
          <Result status="warning" title={t('verify.errorTitle')} subTitle={t('verify.missing')} />
        ) : result.isLoading ? (
          <Result
            icon={<Spin size="large" />}
            title={t('verify.title')}
            subTitle={t('verify.loading')}
          />
        ) : result.isError || !result.data ? (
          <Result
            status="error"
            title={t('verify.errorTitle')}
            subTitle={t('verify.errorText')}
            extra={
              <Link to="/signup/new">
                <Button type="primary">{t('verify.retry')}</Button>
              </Link>
            }
          />
        ) : (
          <Result
            status="success"
            title={t('verify.okTitle')}
            subTitle={t('verify.okText', { host: result.data.host })}
            extra={
              <Button type="primary" size="large" href={result.data.loginUrl}>
                {t('verify.login')}
              </Button>
            }
          />
        )}
      </div>
    </SignupLayout>
  );
}
