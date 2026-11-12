import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { LanguageSwitch } from '@hm/ui';

// Messages are i18n keys, translated at render time.
export const loginSchema = z.object({
  email: z.email('validation.emailInvalid'),
  password: z.string().min(1, 'validation.passwordRequired'),
});

export type LoginValues = z.infer<typeof loginSchema>;

/** Placeholder login: validates the form but performs no API call. */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  return (
    <Flex justify="center" align="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <Flex justify="flex-end">
          <LanguageSwitch label={t('language')} />
        </Flex>
        <Typography.Title level={1} style={{ fontSize: 24, marginBottom: 0 }}>
          {t('login.title')}
        </Typography.Title>
        <Typography.Paragraph type="secondary">{t('login.subtitle')}</Typography.Paragraph>
        <form noValidate onSubmit={handleSubmit(() => navigate('/dashboard'))}>
          <Form layout="vertical" component={false}>
            <Form.Item
              label={t('login.email')}
              htmlFor="email"
              validateStatus={errors.email ? 'error' : ''}
              help={errors.email?.message ? t(errors.email.message) : undefined}
            >
              <Input id="email" type="email" autoComplete="username" {...register('email')} />
            </Form.Item>
            <Form.Item
              label={t('login.password')}
              htmlFor="password"
              validateStatus={errors.password ? 'error' : ''}
              help={errors.password?.message ? t(errors.password.message) : undefined}
            >
              <Input.Password
                id="password"
                autoComplete="current-password"
                {...register('password')}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              {t('login.submit')}
            </Button>
          </Form>
        </form>
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={t('login.placeholderNotice')}
        />
      </Card>
    </Flex>
  );
}
