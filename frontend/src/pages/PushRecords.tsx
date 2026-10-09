import { useEffect, useState, useCallback } from 'react';
import { App as AntApp, Button, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { RotateCw, OctagonX } from 'lucide-react';
import { api, type PushRecordRow } from '../api';
import { GROUP_COLOR, GROUP_LABEL, REASON_META, STATUS_META, type ReasonGroup } from '../reason-codes';

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: PushRecordRow[];
}

interface ReasonSummaryRow {
  status: string;
  reasonCode: string | null;
  _count: { _all: number };
}

/** 推送记录：原因码分组（NO_MOBILE 归入「数据缺口」）、中止/重推人工干预。 */
export default function PushRecords() {
  const { message } = AntApp.useApp();
  const [data, setData] = useState<ListResponse | null>(null);
  const [summary, setSummary] = useState<ReasonSummaryRow[]>([]);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (statusFilter) qs.set('status', statusFilter);
    Promise.all([
      api.get<ListResponse>(`/push-records?${qs.toString()}`),
      api.get<ReasonSummaryRow[]>('/push-records/reasons/summary'),
    ])
      .then(([list, sums]) => {
        setData(list);
        setSummary(sums);
      })
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  useEffect(load, [load]);

  const act = async (id: string, action: 'halt' | 'retry') => {
    try {
      await api.post(`/push-records/${id}/${action}`);
      message.success(action === 'halt' ? '已中止' : '已重推');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  // 按原因码分组聚合（人工中止 reasonCode 为空，用 failReason 识别）
  const groupAgg = (Object.keys(GROUP_LABEL) as ReasonGroup[]).map((g) => ({
    group: g,
    count: summary
      .filter((r) => r.reasonCode && REASON_META[r.reasonCode]?.group === g)
      .reduce((s, r) => s + r._count._all, 0),
  }));

  const columns: ColumnsType<PushRecordRow> = [
    { title: '项目', dataIndex: 'communityName', render: (v: string | null) => v ?? '-' },
    { title: '房屋', dataIndex: 'houseName', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '城市', dataIndex: 'city', width: 70, render: (v: string | null) => v ?? '-' },
    { title: '手机号', dataIndex: 'mobileMasked', width: 130, render: (v: string | null) => v ?? '—' },
    { title: '产品包', dataIndex: ['package', 'name'], width: 120, render: (v: string | null) => v ?? '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={STATUS_META[v]?.color}>{STATUS_META[v]?.label ?? v}</Tag>,
    },
    {
      title: '原因码',
      dataIndex: 'reasonCode',
      width: 150,
      render: (v: string | null, row) => {
        if (v && REASON_META[v]) {
          const meta = REASON_META[v];
          return (
            <Tag color={GROUP_COLOR[meta.group]} title={meta.advice}>
              {meta.label}
            </Tag>
          );
        }
        if (row.failReason === 'MANUAL_HALT') return <Tag>人工中止</Tag>;
        return '-';
      },
    },
    { title: '发送时间', dataIndex: 'sentAt', width: 170, render: (v: string | null) => v?.slice(0, 19).replace('T', ' ') ?? '-' },
    {
      title: '操作',
      width: 150,
      render: (_, row) => (
        <Space>
          {row.status === 'failed' && (
            <Button size="small" icon={<RotateCw size={13} />} onClick={() => act(row.id, 'retry')}>
              重推
            </Button>
          )}
          {(row.status === 'queued' || row.status === 'deferred') && (
            <Button size="small" danger icon={<OctagonX size={13} />} onClick={() => act(row.id, 'halt')}>
              中止
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        {groupAgg.map(({ group, count }) => (
          <Tag key={group} color={GROUP_COLOR[group]} style={{ padding: '2px 10px' }}>
            {GROUP_LABEL[group]} {count}
          </Tag>
        ))}
        <Tag style={{ padding: '2px 10px' }}>已发送 {summary.filter((r) => r.status === 'sent').reduce((s, r) => s + r._count._all, 0)}</Tag>
      </Space>
      <Space>
        状态筛选：
        <Select
          allowClear
          style={{ width: 160 }}
          placeholder="全部状态"
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))}
        />
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data?.items ?? []}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          showTotal: (t) => `共 ${t} 条`,
          onChange: setPage,
        }}
      />
    </Space>
  );
}
