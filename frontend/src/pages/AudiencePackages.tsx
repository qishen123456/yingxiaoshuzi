import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Descriptions, Modal, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Eye, Send } from 'lucide-react';
import { api, type AudiencePackageDetail, type AudiencePackageRow } from '../api';

interface Props { onPush: (ids: string[], meta?: { id?: string; name?: string; criteria?: string | null }) => void; }
export default function AudiencePackages({ onPush }: Props) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<AudiencePackageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<AudiencePackageDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const load = () => { setLoading(true); api.get<AudiencePackageRow[]>('/audience-packages').then(setRows).catch((e) => message.error(e.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  const showDetail = async (id: string) => {
    try { setDetail(await api.get<AudiencePackageDetail>('/audience-packages/' + id)); setDetailOpen(true); }
    catch (e) { message.error((e as Error).message); }
  };
  const columns: ColumnsType<AudiencePackageRow> = [
    { title: '人群包名称 / 编号', dataIndex: 'name', render: (v: string, row) => <><Typography.Text strong>{v}</Typography.Text><div style={{ color: '#94a0ae', fontSize: 10 }}>#{row.id}</div></> },
    { title: '创建人', dataIndex: 'createdBy' },
    { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => v.replace('T', ' ').slice(0, 19) },
    { title: '房屋数量', dataIndex: 'houseCount', render: (v: number, row) => <><Typography.Text strong>{v.toLocaleString()} 套</Typography.Text><div style={{ color: '#8a98a7', fontSize: 10 }}>去重号码 {row.uniquePhoneCount}</div></> },
    { title: '筛选条件', dataIndex: 'criteria', render: (v: string | null) => v || '-' },
    { title: '操作', width: 160, render: (_, row) => <Space><Button size="small" icon={<Eye size={13} />} onClick={() => showDetail(row.id)}>明细</Button><Button type="primary" size="small" icon={<Send size={13} />} onClick={async () => { try { const d = await api.get<AudiencePackageDetail>('/audience-packages/' + row.id); onPush(d.houseIds, { id: d.id, name: d.name, criteria: d.criteria }); } catch (e) { message.error((e as Error).message); } }}>推送</Button></Space> },
  ];
  // Details are fetched from the database on demand; re-push sends the frozen house ids to the audience page.
  const detailColumns: ColumnsType<Record<string, unknown>> = [
    { title: '项目', dataIndex: 'communityName' }, { title: '房屋', dataIndex: 'houseName' },
    { title: '城市', dataIndex: 'city' }, { title: '手机号', dataIndex: 'mobileMasked' },
    { title: '命中产品', dataIndex: ['winningPackage', 'name'] },
    { title: '标签快照', dataIndex: 'labels', render: (v: Record<string, unknown>) => Object.entries(v || {}).map(([k, val]) => k + '：' + (Array.isArray(val) ? val.join('、') : String(val))).join('；') },
  ];
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <div><Typography.Title level={3} style={{ margin: 0 }}>人群包管理</Typography.Title><Typography.Paragraph type="secondary" style={{ margin: '5px 0 0' }}>已保存的人群包会固定创建时的房屋、标签和产品命中快照；再次触达前仍需由后端执行频控与黑名单检查。</Typography.Paragraph></div>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><Card size="small"><Typography.Text type="secondary">已保存人群包</Typography.Text><Typography.Title level={3} style={{ margin: '4px 0 0' }}>{rows.length}</Typography.Title></Card><Card size="small"><Typography.Text type="secondary">累计入包房屋</Typography.Text><Typography.Title level={3} style={{ margin: '4px 0 0' }}>{rows.reduce((s, r) => s + r.houseCount, 0).toLocaleString()}</Typography.Title></Card><Button onClick={load}>刷新</Button></div>
    <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} pagination={{ pageSize: 10 }} />
    <Modal width={950} title={detail ? '人群包明细 · ' + detail.name : '人群包明细'} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={<Space><Button onClick={() => setDetailOpen(false)}>关闭</Button><Button type="primary" icon={<Send size={13} />} disabled={!detail} onClick={() => { if(detail) { setDetailOpen(false); onPush(detail.houseIds,{id:detail.id,name:detail.name,criteria:detail.criteria}); } }}>使用该人群包推送</Button></Space>}>
      {detail && <><Descriptions size="small" bordered column={3}><Descriptions.Item label="创建人">{detail.createdBy}</Descriptions.Item><Descriptions.Item label="创建时间">{detail.createdAt.slice(0,19).replace('T',' ')}</Descriptions.Item><Descriptions.Item label="房屋数">{detail.houseCount}</Descriptions.Item><Descriptions.Item label="去重号码">{detail.uniquePhoneCount}</Descriptions.Item><Descriptions.Item label="筛选条件" span={2}>{detail.criteria || '-'}</Descriptions.Item></Descriptions><Table rowKey={(r) => String(r.houseId)} size="small" dataSource={detail.houses as unknown as Record<string,unknown>[]} columns={detailColumns} pagination={{ pageSize: 8 }} scroll={{ x: 900 }} /></>}
    </Modal>
  </Space>;
}
