import { Empty, Typography } from 'antd';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Call to action, typically a Button. */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <>
          <Typography.Text strong>{title}</Typography.Text>
          {description ? (
            <>
              <br />
              <Typography.Text type="secondary">{description}</Typography.Text>
            </>
          ) : null}
        </>
      }
    >
      {action}
    </Empty>
  );
}
