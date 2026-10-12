import { useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Descriptions, Image, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, type MarketingPushBatchDetail, type MarketingPushBatchRow } from '../api';

export default function MarketingPushBatches() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<MarketingPushBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<MarketingPushBatchDetail | null>(null);
  const [open, setOpen] = useState(false);
  const load = (q = query) => { setLoading(true); api.get<MarketingPushBatchRow[]>('/marketing-push-batches' + (q.trim() ? '?q=' + encodeURIComponent(q.trim()) : '')).then(setRows).catch((e) => message.error(e.message)).finally(() => setLoading(false)); };
  useEffect(() => { load(''); }, []);
  const showDetail = async (id: string) => { try { setDetail(await api.get<MarketingPushBatchDetail>('/marketing-push-batches/' + id)); setOpen(true); } catch(e) { message.error((e as Error).message); } };
  const columns: ColumnsType<MarketingPushBatchRow> = [
    { title: '批次编号', dataIndex: 'id', width: 175, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
    { title: '人群包名称', dataIndex: 'packageName', render: (v: string, row) => <><Typography.Text strong>{v}</Typography.Text><div style={{ color: '#8b98a7', fontSize: 10 }}>{row.criteria || '未填写筛选说明'}</div></> },
    { title: '推送发起人', dataIndex: 'sender', width: 160 },
    { title: '推送时间', dataIndex: 'createdAt', width: 165, render: (v: string) => v.slice(0,19).replace('T',' ') },
    { title: '触达渠道', dataIndex: 'channels', width: 190, render: (v: string[]) => <Space wrap>{v.map((c)=><Tag key={c}>{c}</Tag>)}</Space> },
    { title: '目标房屋', dataIndex: 'houseCount', width: 110, render: (v: number, row) => <><Typography.Text strong>{v} 套</Typography.Text><div style={{ color: '#8b98a7', fontSize: 10 }}>去重号码 {row.uniquePhoneCount}</div></> },
    { title: '海报', dataIndex: 'posterName', render: (v: string | null) => v || '系统默认模板' },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color="gold">{v === 'recorded_demo' ? '已记录 · 未发送' : v}</Tag> },
    { title: '操作', width: 100, render: (_, row) => <Button size="small" onClick={() => showDetail(row.id)}>查看内容与明细</Button> },
  ];
  const houseColumns: ColumnsType<Record<string, unknown>> = [
    { title: '项目', dataIndex: 'communityName' }, { title: '房屋名称', dataIndex: 'houseName' },
    { title: '城市', dataIndex: 'city' }, { title: '脱敏号码', dataIndex: 'mobileMasked' },
    { title: '命中产品', dataIndex: ['winningPackage','name'] },
    { title: '标签快照', dataIndex: 'labels', render: (v: Record<string, unknown>) => Object.entries(v || {}).map(([k,val])=>k+'：'+(Array.isArray(val)?val.join('、'):String(val))).join('；') },
  ];
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <div><Typography.Title level={3} style={{ margin: 0 }}>推送人群包记录</Typography.Title><Typography.Paragraph type="secondary" style={{ margin: '5px 0 0' }}>记录每次发起人、海报、文案、触达渠道与本次房屋快照。当前状态是批次留痕，未调用实际外部通道。</Typography.Paragraph></div>
    <Card size="small"><Space wrap style={{ width:'100%', justifyContent:'space-between' }}><Space><Input.Search allowClear placeholder="搜索人群包、操作人、文案" value={query} onChange={(e)=>setQuery(e.target.value)} onSearch={load} style={{ width:300 }} /><Button onClick={()=>load('')}>重置</Button></Space><Space><Card size="small"><Typography.Text type="secondary">批次</Typography.Text><Typography.Title level={4} style={{ margin:0 }}>{rows.length}</Typography.Title></Card><Card size="small"><Typography.Text type="secondary">累计房屋</Typography.Text><Typography.Title level={4} style={{ margin:0 }}>{rows.reduce((s,r)=>s+r.houseCount,0).toLocaleString()}</Typography.Title></Card></Space></Space></Card>
    <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 1280 }} pagination={{ pageSize: 10, showTotal: (t)=>'共 '+t+' 条' }} />
    <Modal width={1050} open={open} onCancel={()=>setOpen(false)} title={detail ? '批次详情 · '+detail.packageName : '批次详情'} footer={<Button onClick={()=>setOpen(false)}>关闭</Button>}>
      {detail && <Space direction="vertical" size="middle" style={{width:'100%'}}>
        <Descriptions bordered size="small" column={3}><Descriptions.Item label="批次编号">{detail.id}</Descriptions.Item><Descriptions.Item label="推送人">{detail.sender}</Descriptions.Item><Descriptions.Item label="时间">{detail.createdAt.slice(0,19).replace('T',' ')}</Descriptions.Item><Descriptions.Item label="渠道">{detail.channels.join('、')}</Descriptions.Item><Descriptions.Item label="房屋 / 去重号码">{detail.houseCount} / {detail.uniquePhoneCount}</Descriptions.Item><Descriptions.Item label="状态"><Tag color="gold">已记录 · 未发送</Tag></Descriptions.Item><Descriptions.Item label="筛选条件" span={3}>{detail.criteria || '-'}</Descriptions.Item></Descriptions>
        <Card size="small" title="推送文案快照"><Typography.Paragraph style={{ whiteSpace:'pre-wrap', margin:0 }}>{detail.contentSnapshot}</Typography.Paragraph></Card>
        <Card size="small" title="海报快照">{detail.posterData ? <Image src={detail.posterData} width={180} /> : <Typography.Text type="secondary">{detail.posterName || '未上传海报'}</Typography.Text>}</Card>
        <Typography.Text strong>人群包房屋明细（{detail.houses.length} 套）</Typography.Text>
        <Table rowKey={(r)=>String(r.houseId)} size="small" dataSource={detail.houses as unknown as Record<string,unknown>[]} columns={houseColumns} pagination={{pageSize:8}} scroll={{x:900}} />
      </Space>}
    </Modal>
  </Space>;
}
