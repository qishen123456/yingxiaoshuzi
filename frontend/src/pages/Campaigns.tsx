import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Descriptions, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Play, Info } from 'lucide-react';
import { api, type CampaignTaskRow, type Readiness } from '../api';

/** 每日跑批：就绪状态 + 手动触发（同日幂等）+ 历史任务。 */
export default function Campaigns() {
  const { message } = AntApp.useApp();
  const [tasks, setTasks] = useState<CampaignTaskRow[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [running, setRunning] = useState(false);

  const load = () => {
    api.get<CampaignTaskRow[]>('/campaigns').then(setTasks).catch((e) => message.error(e.message));
    api.get<Readiness>('/sync/readiness').then(setReadiness).catch(() => undefined);
  };
  useEffect(load, []);

  const trigger = () => {
    setRunning(true);
    api
      .post<{ campaignTaskId: string; status: string }>('/campaigns/run', {})
      .then((r) => {
        message.success(`跑批完成：任务 ${r.campaignTaskId}，状态 ${r.status}（同日重复触发为幂等返回）`);
        load();
      })
      .catch((e) => message.error(e.message))
      .finally(() => setRunning(false));
  };

  const gateTag: Record<string, { color: string; text: string }> = {
    active: { color: 'green', text: '线索闸门正常' },
    bypassed_open: { color: 'gold', text: '线索过期 fail-open' },
    unavailable: { color: 'default', text: '无线索数据' },
  };

  const columns: ColumnsType<CampaignTaskRow> = [
    { title: '跑批日期', dataIndex: 'statDate', width: 120 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const color = v === 'success' ? 'green' : v === 'failed' ? 'red' : v === 'running' ? 'processing' : 'default';
        return <Tag color={color}>{v}</Tag>;
      },
    },
    {
      title: '线索闸门',
      dataIndex: 'leadGateState',
      width: 150,
      render: (v: string) => <Tag color={gateTag[v]?.color}>{gateTag[v]?.text ?? v}</Tag>,
    },
    { title: '扫描', dataIndex: 'scannedCount', width: 80 },
    { title: '命中', dataIndex: 'matchedCount', width: 80 },
    { title: '拦截/顺延', dataIndex: 'suppressedCount', width: 100 },
    { title: '入队', dataIndex: 'queuedCount', width: 80 },
    {
      title: '备注',
      dataIndex: 'errorMessage',
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Tag icon={<Info size={12} />} color="orange">
              有备注
            </Tag>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    { title: '完成时间', dataIndex: 'finishedAt', width: 190, render: (v: string | null) => v?.slice(0, 19).replace('T', ' ') ?? '-' },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {readiness && (
        <Alert
          type={readiness.labelReady ? 'success' : 'error'}
          showIcon
          message={
            <Descriptions size="small" column={3} colon={false}>
              <Descriptions.Item label="房屋标签">{readiness.labelReady ? `已就绪（${readiness.labelStatDate}）` : '未就绪，跑批将中止'}</Descriptions.Item>
              <Descriptions.Item label="号码覆盖率">
                {readiness.mobileCoverage === null ? '无数据' : `${(readiness.mobileCoverage * 100).toFixed(1)}%（低于 70% 只生成清单不发送）`}
              </Descriptions.Item>
              <Descriptions.Item label="线索闸门">{gateTag[readiness.leadGateState]?.text}</Descriptions.Item>
            </Descriptions>
          }
        />
      )}
      <Space>
        <Button type="primary" icon={<Play size={14} />} loading={running} onClick={trigger}>
          手动触发当日跑批
        </Button>
        <Typography.Text type="secondary">生产定时：每日 07:30（Asia/Shanghai），归因 09:10；当前 DRY_RUN 不触达真实通道</Typography.Text>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={tasks} pagination={false} />
    </Space>
  );
}
