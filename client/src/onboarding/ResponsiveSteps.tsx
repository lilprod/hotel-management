import { CheckOutlined } from '@ant-design/icons';
import { Flex, Grid, Steps, Tooltip, theme } from 'antd';

/**
 * Steps bar of the wizard. From 1200 px: full labels under the numbered icons (they wrap, never
 * truncate). Below: compact numbered dots, the full label is a tooltip and the accessible name.
 */
export function ResponsiveSteps({
  labels,
  current,
  compact,
}: {
  labels: readonly string[];
  current: number;
  /** Forces a layout (tests); by default it follows the viewport. */
  compact?: boolean;
}) {
  const screens = Grid.useBreakpoint();
  const { token } = theme.useToken();
  const dots = compact ?? !screens.xl;
  if (!dots)
    return (
      <Steps
        size="small"
        labelPlacement="vertical"
        current={current}
        style={{ margin: '16px 0 24px' }}
        items={labels.map((title, i) => ({
          title: <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{title}</span>,
          status: i < current ? 'finish' : i === current ? 'process' : 'wait',
        }))}
      />
    );
  return (
    <ol
      data-testid="steps-compact"
      style={{ display: 'flex', gap: 8, listStyle: 'none', margin: '16px 0 24px', padding: 0 }}
    >
      {labels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} aria-current={active ? 'step' : undefined}>
            <Tooltip title={label}>
              <Flex
                align="center"
                justify="center"
                role="img"
                aria-label={label}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  fontSize: 13,
                  fontWeight: 600,
                  color: active ? token.colorTextLightSolid : token.colorTextSecondary,
                  background: active
                    ? token.colorPrimary
                    : done
                      ? token.colorPrimaryBg
                      : token.colorFillSecondary,
                }}
              >
                {done ? <CheckOutlined /> : i + 1}
              </Flex>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}
