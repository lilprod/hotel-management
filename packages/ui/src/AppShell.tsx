import { Layout, Menu, Tag, theme as antTheme } from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';

export interface ShellNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
  path: string;
}

export interface AppShellProps {
  brandName: string;
  logoUrl?: string | null;
  /** Small badge under the brand name (e.g. "Super Admin"). */
  brandBadge?: string;
  /** Text color on the sidebar background; defaults to white. */
  siderTextColor?: string;
  items: ShellNavItem[];
  selectedKey?: string | undefined;
  onNavigate: (path: string) => void;
  /** Content of the top bar (actions, switches, user menu). */
  header: ReactNode;
  navLabel: string;
  skipLabel: string;
  children: ReactNode;
}

const skipLinkCss = `
.hm-skip-link{position:absolute;left:8px;top:-100px;z-index:1100;padding:8px 12px;background:#fff;color:#000;border-radius:4px}
.hm-skip-link:focus{top:8px}
`;

/** Collapsible-sidebar layout shared by the staff and Super Admin apps (collapses below 992px). */
export function AppShell({
  brandName,
  logoUrl,
  brandBadge,
  siderTextColor = '#ffffff',
  items,
  selectedKey,
  onNavigate,
  header,
  navLabel,
  skipLabel,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { token } = antTheme.useToken();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <style>{skipLinkCss}</style>
      <a className="hm-skip-link" href="#main-content">
        {skipLabel}
      </a>
      <Layout.Sider
        breakpoint="lg"
        collapsible
        collapsed={collapsed}
        onBreakpoint={setCollapsed}
        onCollapse={setCollapsed}
        width={240}
        collapsedWidth={64}
        theme="dark"
        aria-label={navLabel}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div
          data-testid="brand-block"
          title={collapsed ? brandName : undefined}
          style={{
            minHeight: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 10,
            padding: collapsed ? '8px 0' : '8px 16px',
            color: siderTextColor,
            overflow: 'hidden',
          }}
        >
          {logoUrl ? (
            <img src={logoUrl} alt="" height={28} style={{ maxWidth: 40, objectFit: 'contain' }} />
          ) : (
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 32px',
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                background: token.colorPrimary,
                color: token.colorTextLightSolid,
              }}
            >
              {brandName.trim().charAt(0).toUpperCase()}
            </span>
          )}
          {collapsed ? null : (
            <span
              style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}
            >
              <span
                title={brandName}
                style={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {brandName}
              </span>
              {brandBadge ? (
                <Tag
                  bordered={false}
                  style={{ alignSelf: 'flex-start', marginInlineEnd: 0, fontSize: 11 }}
                >
                  {brandBadge}
                </Tag>
              ) : null}
            </span>
          )}
        </div>
        <nav aria-label={navLabel}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={items.map((i) => ({ key: i.key, icon: i.icon, label: i.label }))}
            onClick={({ key }) => {
              const item = items.find((i) => i.key === key);
              if (item) onNavigate(item.path);
            }}
          />
        </nav>
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '0 16px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          {header}
        </Layout.Header>
        <Layout.Content id="main-content" tabIndex={-1} style={{ padding: 24 }}>
          {children}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
