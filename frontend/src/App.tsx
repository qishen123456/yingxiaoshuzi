import { useState } from 'react';
import { Layout, Tabs, Typography } from 'antd';
import { LayoutDashboard, SlidersHorizontal, CalendarClock, Send } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Rules from './pages/Rules';
import Campaigns from './pages/Campaigns';
import PushRecords from './pages/PushRecords';

const { Header, Content } = Layout;
const { Title } = Typography;

export default function App() {
  const [tab, setTab] = useState('dashboard');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: '#1D5A96',
          paddingInline: 24,
        }}
      >
        <Title level={4} style={{ color: '#fff', margin: 0, whiteSpace: 'nowrap' }}>
          研选营销智能推送系统
        </Title>
        <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
          责任盘业主 · 规则圈选 · 频控触达 · T+1 归因
        </span>
      </Header>
      <Content style={{ padding: 20 }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'dashboard',
              label: (
                <span>
                  <LayoutDashboard size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  运营看板
                </span>
              ),
              children: <Dashboard />,
            },
            {
              key: 'rules',
              label: (
                <span>
                  <SlidersHorizontal size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  规则配置
                </span>
              ),
              children: <Rules />,
            },
            {
              key: 'campaigns',
              label: (
                <span>
                  <CalendarClock size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  跑批任务
                </span>
              ),
              children: <Campaigns />,
            },
            {
              key: 'records',
              label: (
                <span>
                  <Send size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  推送记录
                </span>
              ),
              children: <PushRecords />,
            },
          ]}
        />
      </Content>
    </Layout>
  );
}
