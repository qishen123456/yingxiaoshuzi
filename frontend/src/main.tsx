import '@ant-design/v5-patch-for-react-19';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

// 品牌主色：墨钢蓝 #1D5A96（全系统唯一蓝色来源，禁止硬编码其他蓝）
const BRAND_BLUE = '#1D5A96';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: BRAND_BLUE,
          colorLink: BRAND_BLUE,
          borderRadius: 6,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif",
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
