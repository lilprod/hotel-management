import { Tag } from 'antd';

/** Default status to Ant Design color map, shared by all apps for consistent status colors. */
export const defaultStatusColors: Record<string, string> = {
  pending: 'gold',
  confirmed: 'blue',
  checked_in: 'green',
  checked_out: 'default',
  cancelled: 'red',
  no_show: 'volcano',
  paid: 'green',
  partial: 'orange',
  unpaid: 'red',
  overdue: 'red',
  draft: 'default',
  active: 'green',
  suspended: 'orange',
  clean: 'green',
  dirty: 'orange',
  inspected: 'cyan',
  out_of_service: 'default',
};

export interface StatusTagProps {
  status: string;
  /** Overrides or extends the default map. */
  colors?: Record<string, string>;
  /** Display text; defaults to a humanized status (the status is never conveyed by color alone). */
  label?: string;
}

function humanize(status: string): string {
  const text = status.replace(/[_-]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusTag({ status, colors, label }: StatusTagProps) {
  const color = { ...defaultStatusColors, ...colors }[status] ?? 'default';
  return (
    <Tag color={color} data-status={status}>
      {label ?? humanize(status)}
    </Tag>
  );
}
