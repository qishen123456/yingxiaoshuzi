import { useCallback, useMemo, useState } from 'react';
import { Layout, Menu, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  Activity, CalendarClock, ClipboardList, FileImage, History,
  LayoutDashboard, Send, SlidersHorizontal, Tags, Users,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Rules from './pages/Rules';
import Campaigns from './pages/Campaigns';
import PushRecords from './pages/PushRecords';
import Audience from './pages/Audience';
import TagMaintenance from './pages/TagMaintenance';
import AudiencePackages from './pages/AudiencePackages';
import MarketingPushBatches from './pages/MarketingPushBatches';
import PosterTemplates from './pages/PosterTemplates';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
type PageKey = 'dashboard' | 'audience' | 'rules' | 'tags' | 'packages' | 'posters' | 'campaigns' | 'batches' | 'records';
type MenuItem = Required<MenuProps>['items'][number];

const PAGE_TITLES: Record<PageKey, string> = {
  dashboard: '运营看板',
  audience: '潜客挖掘',
  rules: '产品标签映射',
  tags: '标签维护',
  packages: '人群包管理',
  posters: '海报模板配置',
  campaigns: '定时推送与跑批',
  batches: '推送人群包记录',
  records: '发送明细记录',
};
const ICONS: Record<PageKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  audience: Users,
  rules: SlidersHorizontal,
  tags: Tags,
  packages: ClipboardList,
  posters: FileImage,
  campaigns: CalendarClock,
  batches: History,
  records: Send,
};

export default function App() {
  const [active, setActive] = useState<PageKey>('audience');
  const [collapsed, setCollapsed] = useState(false);
  const [prefill, setPrefill] = useState<{ ids: string[]; packageId?: string; packageName?: string; criteria?: string } | null>(null);
  const { token } = theme.useToken();

  const menuItems = useMemo<MenuProps['items']>(() => {
    const children = (Object.keys(PAGE_TITLES) as PageKey[]).map((key) => {
      const Icon = ICONS[key];
      return {
        key,
        icon: <Icon size={16} strokeWidth={1.8} />,
        label: PAGE_TITLES[key],
      };
    });
    return [{ key: 'full-disk-group', type: 'group', label: '满盘管理', children: children as MenuItem[] }] as MenuProps['items'];
  }, []);

  const navigate = (key: string) => {
    if (key in PAGE_TITLES) setActive(key as PageKey);
  };
  const openAudience = (ids: string[], packageMeta?: { id?: string; name?: string; criteria?: string | null }) => {
    setPrefill({ ids, packageId: packageMeta?.id, packageName: packageMeta?.name, criteria: packageMeta?.criteria ?? undefined });
    setActive('audience');
  };
  const clearPrefill = useCallback(() => setPrefill(null), []);

  let page = null;
  if (active === 'dashboard') page = <Dashboard />;
  else if (active === 'audience') page = <Audience prefill={prefill} onClearPrefill={clearPrefill} onNavigate={navigate} />;
  else if (active === 'rules') page = <Rules />;
  else if (active === 'tags') page = <TagMaintenance />;
  else if (active === 'packages') page = <AudiencePackages onPush={openAudience} />;
  else if (active === 'posters') page = <PosterTemplates />;
  else if (active === 'campaigns') page = <Campaigns />;
  else if (active === 'batches') page = <MarketingPushBatches />;
  else page = <PushRecords />;

  return (
    <Layout style={{ minHeight: '100vh', background: '#f4f7fb' }}>
      <Sider
        width={244}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => setCollapsed(broken)}
        style={{ background: '#10243b', boxShadow: '2px 0 16px rgba(15,34,56,.08)' }}
      >
        <div style={{ padding: collapsed ? '23px 8px' : '22px 20px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
          <Title level={4} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap', fontSize: collapsed ? 14 : 18 }}>
            {collapsed ? '研选' : '研选责任盘'}
          </Title>
          {!collapsed && <Text style={{ display: 'block', marginTop: 5, color: 'rgba(228,239,250,.58)', fontSize: 11 }}>营销智能推送工作台</Text>}
        </div>
        <div style={{ padding: '12px 10px 0', color: 'rgba(215,231,246,.46)', fontSize: 10, fontWeight: 700, letterSpacing: '.12em' }}>
          {!collapsed && 'WORKSPACE'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[active]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 2, background: 'transparent', borderInlineEnd: 0, fontSize: 12 }}
        />
        {!collapsed && (
          <div style={{ margin: 'auto 12px 14px', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.07)', background: 'rgba(255,255,255,.045)', color: 'rgba(225,237,249,.6)', fontSize: 10.5, lineHeight: 1.8 }}>
            <div><Activity size={11} style={{ verticalAlign: -2, marginRight: 5 }} />系统数据与规则统一读取</div>
            <div>房屋标签 T+1 · 后端规则引擎</div>
            <div>真实通道需联调后启用</div>
          </div>
        )}
      </Sider>
      <Layout style={{ minWidth: 0, background: '#f4f7fb' }}>
        <Header style={{ height: 64, lineHeight: 'normal', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingInline: 24, background: '#fff', borderBottom: '1px solid #e7edf3' }}>
          <div>
            <div style={{ color: token.colorTextTertiary, fontSize: 11, marginBottom: 4 }}>满盘管理 / {PAGE_TITLES[active]}</div>
            <Title level={4} style={{ margin: 0, color: '#20384f', fontSize: 19 }}>{PAGE_TITLES[active]}</Title>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Text strong style={{ display: 'block', color: '#35516c', fontSize: 11 }}>研选营销智能推送系统</Text>
            <Text type="secondary" style={{ fontSize: 10 }}>责任盘业主 · 标签圈选 · 频控触达 · T+1 归因</Text>
          </div>
        </Header>
        <Content style={{ padding: 20, minWidth: 0 }}>
          <div style={{ maxWidth: 1680, margin: '0 auto' }}>{page}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
