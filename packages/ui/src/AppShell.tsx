import { Layout, Menu, theme as antTheme } from 'antd';
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
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            color: '#fff',
            fontWeight: 600,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {logoUrl ? <img src={logoUrl} alt="" height={28} /> : null}
          {collapsed ? null : <span>{brandName}</span>}
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
