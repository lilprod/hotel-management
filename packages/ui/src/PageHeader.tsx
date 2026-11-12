import { Breadcrumb, Flex, Typography } from 'antd';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: { title: ReactNode; href?: string }[];
  /** Right-aligned actions (buttons). */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header style={{ marginBottom: 24 }}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <Breadcrumb items={breadcrumb} style={{ marginBottom: 8 }} />
      ) : null}
      <Flex justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <Typography.Title level={1} style={{ fontSize: 24, margin: 0 }}>
            {title}
          </Typography.Title>
          {subtitle ? (
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
              {subtitle}
            </Typography.Paragraph>
          ) : null}
        </div>
        {actions ? (
          <Flex gap={8} wrap>
            {actions}
          </Flex>
        ) : null}
      </Flex>
    </header>
  );
}
