import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import { App as AntApp, Alert, Button, Card, Checkbox, Col, Divider, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { FileImage, Filter, Save, Send, Users } from 'lucide-react';
import { api, type AudiencePackageRow, type HouseListItem, type HouseSearchResponse, type ProductPackageOption, type ProjectCatalogRow, type TagAdminRow } from '../api';

interface Props {
  prefill: { ids: string[]; packageId?: string; packageName?: string; criteria?: string } | null;
  onClearPrefill: () => void;
  onNavigate: (page: string) => void;
}

const CHANNELS = [
  { label: '推广短信', value: '推广短信' },
  { label: '微信通知', value: '微信通知' },
  { label: '住这儿通知', value: '住这儿通知' },
  { label: '管家企微', value: '管家企微' },
];

async function compressImage(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法解码'));
    image.src = source;
  });
  const scale = Math.min(1, 1200 / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片压缩');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.78);
}

function labelText(labels: Record<string, unknown>, dictionary: TagAdminRow[]) {
  const nameByKey = new Map(dictionary.map((tag) => [tag.tagKey, tag.tagName]));
  return Object.entries(labels || {}).flatMap(([key, raw]) => {
    const values = Array.isArray(raw) ? raw.map(String) : raw == null || raw === '' ? [] : [String(raw)];
    return values.map((value) => (nameByKey.get(key) || key) + '：' + value);
  });
}

export default function Audience({ prefill, onClearPrefill, onNavigate }: Props) {
  const { message } = AntApp.useApp();
  const [projects, setProjects] = useState<ProjectCatalogRow[]>([]);
  const [tags, setTags] = useState<TagAdminRow[]>([]);
  const [products, setProducts] = useState<ProductPackageOption[]>([]);
  const [prefillPackageId, setPrefillPackageId] = useState<string | undefined>();
  const [rows, setRows] = useState<HouseListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [city, setCity] = useState<string>();
  const [communityId, setCommunityId] = useState<string>();
  const [packageId, setPackageId] = useState<string>();
  const [tagKey, setTagKey] = useState<string>();
  const [tagValue, setTagValue] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [result, setResult] = useState<HouseSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [packageName, setPackageName] = useState('');
  const [criteria, setCriteria] = useState('');
  const [pushOpen, setPushOpen] = useState(false);
  const [pushName, setPushName] = useState('');
  const [copy, setCopy] = useState('您好，研选为本项目业主提供房屋养护与局部焕新服务。可根据房屋情况预约检测或咨询方案，回复【预约】了解详情。');
  const [channels, setChannels] = useState<string[]>(['管家企微']);
  const [posterData, setPosterData] = useState('');
  const [posterName, setPosterName] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const cities = useMemo(() => [...new Set(projects.map((p) => p.city))], [projects]);
  const projectOptions = projects.filter((p) => !city || p.city === city).map((p) => ({ label: p.projectName, value: p.projectId }));
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row.houseId)), [rows, selectedIds]);

  useEffect(() => {
    api.get<ProjectCatalogRow[]>('/project-catalog').then(setProjects).catch((e) => setError(e.message));
    api.get<TagAdminRow[]>('/tags/admin').then(setTags).catch(() => api.get<TagAdminRow[]>('/tags').then((items) => setTags(items)));
    api.get<ProductPackageOption[]>('/packages').then(setProducts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (prefill?.ids?.length) {
      setSelectedIds(prefill.ids);
      setPrefillPackageId(prefill.packageId);
      setPushName(prefill.packageName || '已保存人群包再次推送');
      setCriteria(prefill.criteria || '来自已保存人群包');
      setPage(1);
      onClearPrefill();
    }
  }, [prefill, onClearPrefill]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (city) qs.set('city', city);
    if (communityId) qs.set('communityId', communityId);
    if (keyword.trim()) qs.set('q', keyword.trim());
    if (tagKey) qs.set('tagKey', tagKey);
    if (tagValue) qs.set('tagValue', tagValue);
    if (packageId) qs.set('packageId', packageId);
    api.get<HouseSearchResponse>('/houses?' + qs.toString())
      .then((response) => { if (!cancelled) { setResult(response); setRows(response.items); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [city, communityId, keyword, tagKey, tagValue, packageId, page, pageSize]);

  const reset = () => {
    setCity(undefined); setCommunityId(undefined); setPackageId(undefined); setTagKey(undefined); setTagValue(undefined);
    setKeyword(''); setPage(1); setSelectedIds([]);
  };
  const currentCriteria = () => [
    city ? '城市=' + city : '', communityId ? '项目=' + (projects.find((p) => p.projectId === communityId)?.projectName || communityId) : '',
    packageId ? '命中产品包=' + (packageId === 'none' ? '未命中' : packageId) : '',
    tagKey ? '标签=' + (tags.find((t) => t.tagKey === tagKey)?.tagName || tagKey) + (tagValue ? ':' + tagValue : '') : '',
    keyword.trim() ? '关键词=' + keyword.trim() : '',
  ].filter(Boolean).join('；') || '按一线当前筛选条件及选择结果';
  const openSave = () => {
    if (!selectedIds.length) { message.warning('请先勾选要保存的人群房屋'); return; }
    setPackageName((projects.find((p) => p.projectId === communityId)?.projectName || city || '满盘') + ' · 营销人群包');
    setCriteria(currentCriteria());
    setSaveOpen(true);
  };
  const savePackage = async () => {
    if (!packageName.trim()) { message.warning('请填写人群包名称'); return; }
    try {
      const created = await api.post<AudiencePackageRow>('/audience-packages', { name: packageName.trim(), criteria, houseIds: selectedIds.map(String) });
      message.success('人群包已保存：' + created.name + '（' + created.houseCount + ' 套）');
      setSaveOpen(false);
      onNavigate('packages');
    } catch (e) { message.error((e as Error).message); }
  };
  const openPush = () => {
    if (!selectedIds.length) { message.warning('请先勾选目标房屋'); return; }
    setPushName((projects.find((p) => p.projectId === communityId)?.projectName || city || '满盘') + ' · 营销推送人群包');
    setCriteria(currentCriteria());
    setCopy(selectedRows.length && selectedRows.every((r) => r.winningPackage?.name === selectedRows[0].winningPackage?.name) && selectedRows[0].winningPackage
      ? '您好，研选为您准备了「' + selectedRows[0].winningPackage.name + '」相关服务，可预约了解适合您家的改善方案。回复【预约】获取详情。'
      : '您好，研选为本项目业主提供房屋养护与局部焕新服务。可根据房屋情况预约检测或咨询方案，回复【预约】了解详情。');
    setPosterData(''); setPosterName(''); setChannels(['管家企微']); setPushOpen(true);
  };
  const createBatch = async () => {
    if (!pushName.trim() || !copy.trim() || !channels.length) { message.warning('请填写人群包名称、文案并选择至少一个渠道'); return; }
    setPushBusy(true);
    try {
      await api.post('/marketing-push-batches', {
        packageName: pushName.trim(), contentSnapshot: copy.trim(), posterName: posterName || '系统默认模板',
        posterData, channels, criteria, houseIds: selectedIds.map(String),
        audiencePackageId: prefillPackageId || undefined,
      });
      message.success('推送批次已保存。当前为演示记录，未调用真实触达通道。');
      setPushOpen(false);
      onNavigate('batches');
    } catch (e) { message.error((e as Error).message); }
    finally { setPushBusy(false); }
  };

  const columns: ColumnsType<HouseListItem> = [
    { title: '项目', dataIndex: 'communityName', width: 160, render: (v: string | null, r) => v || r.communityId || '-' },
    { title: '房屋名称', dataIndex: 'houseName', width: 240, render: (v: string | null, r) => <Typography.Text strong>{v || r.houseId}</Typography.Text> },
    { title: '城市', dataIndex: 'city', width: 80 },
    { title: '业主', dataIndex: 'ownerNameMasked', width: 100, render: (v: string | null) => v || '-' },
    { title: '联系电话', dataIndex: 'mobileMasked', width: 170, render: (v: string | null, row) => row.hasMobile ? <Tag color="blue">{v}</Tag> : v ? <Tag color="gold" title="index-v3 样本中的脱敏号码，只作页面展示，不是可触达的真实联系方式">{v} · 样本号</Tag> : <Tag color="orange">无号码</Tag> },
    { title: '标签命中', dataIndex: 'labels', width: 300, render: (v: Record<string, unknown>) => {
      const flat = labelText(v, tags).slice(0, 6);
      return <Space size={[3, 4]} wrap>{flat.map((label) => <Tag key={label}>{label}</Tag>)}{!flat.length && '-'}</Space>;
    }},
    { title: '命中产品', dataIndex: 'winningPackage', width: 140, render: (v: HouseListItem['winningPackage']) => v ? <Tag color="#1D5A96">{v.name}</Tag> : <Tag>未命中</Tag> },
    { title: '线索数量', dataIndex: 'leadCount', width: 85 },
    { title: '上次推送', dataIndex: 'lastPushAt', width: 150, render: (v: string | null) => v ? v.slice(0, 10) : '未推送' },
    { title: '标签日期', dataIndex: 'statDate', width: 110 },
  ];

  const tagChoices = tags.filter((t) => t.ruleEnabled || t.dataReady).map((t) => ({ label: t.tagName, value: t.tagKey }));
  const valueChoices = tags.find((t) => t.tagKey === tagKey)?.enumValues?.map((value) => ({ label: value, value })) || [];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div><Typography.Title level={3} style={{ margin: 0 }}>潜客挖掘</Typography.Title><Typography.Paragraph type="secondary" style={{ margin: '5px 0 0' }}>从现有房屋标签快照中筛选一线目标人群，勾选后可保存人群包或配置海报与文案。</Typography.Paragraph></div>
        <Space wrap><Button onClick={() => onNavigate('tags')}>标签维护</Button><Button onClick={() => onNavigate('rules')}>产品标签映射</Button><Button onClick={() => onNavigate('packages')}>人群包管理</Button><Button onClick={() => onNavigate('batches')}>推送记录</Button></Space>
      </div>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="当前命中结果" value={result?.total ?? 0} prefix={<Filter size={15} />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="本次勾选房屋" value={selectedIds.length} prefix={<Users size={15} />} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="去重号码（估算）" value={new Set(rows.filter((r) => selectedIds.includes(r.houseId)).map((r) => r.mobileMasked).filter(Boolean)).size} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="标签快照日期" value={rows[0]?.statDate || '-'} valueStyle={{ fontSize: 17 }} /></Card></Col>
      </Row>
      {error && <Alert type="error" showIcon message="房屋数据加载失败" description={error} />}
      {result?.scanLimitReached && <Alert type="warning" showIcon message="当前筛选范围较大" description={'已扫描 ' + result.candidateCount.toLocaleString() + ' 套候选中的前部分数据。建议先选择城市或项目缩小范围，再查看准确筛选结果。'} />}
      <Card size="small" title="人群筛选" extra={<Button onClick={reset}>重置条件</Button>}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={6}><Typography.Text type="secondary">城市</Typography.Text><Select allowClear showSearch style={{ width: '100%', marginTop: 5 }} placeholder="全部城市" value={city} onChange={(value) => { setCity(value); setCommunityId(undefined); setPage(1); }} options={cities.map((value) => ({ label: value, value }))} /></Col>
          <Col xs={24} md={6}><Typography.Text type="secondary">责任盘项目</Typography.Text><Select allowClear showSearch optionFilterProp="label" style={{ width: '100%', marginTop: 5 }} placeholder="全部项目" value={communityId} onChange={(value) => { setCommunityId(value); setPage(1); }} options={projectOptions} /></Col>
          <Col xs={24} md={6}><Typography.Text type="secondary">命中产品包</Typography.Text><Select allowClear style={{ width: '100%', marginTop: 5 }} placeholder="全部产品" value={packageId} onChange={(value) => { setPackageId(value); setPage(1); }} options={[{ label: '未命中产品', value: 'none' }, ...products.map((p) => ({ label: p.name, value: p.id }))]} /></Col>
          <Col xs={24} md={6}><Typography.Text type="secondary">搜索房屋 / 业主</Typography.Text><Input allowClear value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} placeholder="房屋名称、编号、脱敏业主" style={{ marginTop: 5 }} /></Col>
          <Col xs={24} md={6}><Typography.Text type="secondary">标签类型</Typography.Text><Select allowClear showSearch style={{ width: '100%', marginTop: 5 }} placeholder="全部标签" value={tagKey} onChange={(value) => { setTagKey(value); setTagValue(undefined); setPage(1); }} options={tagChoices} /></Col>
          <Col xs={24} md={6}><Typography.Text type="secondary">标签取值</Typography.Text><Select allowClear showSearch style={{ width: '100%', marginTop: 5 }} placeholder="全部取值" disabled={!tagKey} value={tagValue} onChange={(value) => { setTagValue(value); setPage(1); }} options={valueChoices} /></Col>
          <Col xs={24} md={12} style={{ display: 'flex', alignItems: 'end', justifyContent: 'flex-end' }}><Typography.Text type="secondary">数据源：house_label_snapshot · 规则由后端统一计算</Typography.Text></Col>
        </Row>
      </Card>
      <Card size="small" bodyStyle={{ padding: 0 }} title={<Space>房屋清单 <Tag color="blue">已选 {selectedIds.length} 套</Tag></Space>} extra={<Space wrap><Button icon={<Save size={14} />} disabled={!selectedIds.length} onClick={openSave}>保存人群包</Button><Button type="primary" icon={<Send size={14} />} disabled={!selectedIds.length} onClick={openPush}>配置推送</Button></Space>}>
        <Table rowKey="houseId" size="small" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 1500 }} rowSelection={{ selectedRowKeys: selectedIds, preserveSelectedRowKeys: true, onChange: (keys) => setSelectedIds(keys) }} pagination={{ current: page, pageSize, total: result?.total ?? 0, showSizeChanger: true, showTotal: (total) => '共 ' + total.toLocaleString() + ' 套', onChange: (next, size) => { setPage(next); setPageSize(size); } }} />
      </Card>

      <Modal title="保存为人群包" open={saveOpen} onCancel={() => setSaveOpen(false)} onOk={savePackage} okText="保存人群包" cancelText="取消">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div><Typography.Text>人群包名称 *</Typography.Text><Input value={packageName} onChange={(e) => setPackageName(e.target.value)} maxLength={160} /></div>
          <div><Typography.Text>筛选条件快照</Typography.Text><Input.TextArea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></div>
          <Alert type="info" showIcon message={'将保存 ' + selectedIds.length + ' 套房屋的标签、命中产品和房屋编码快照。'} />
        </Space>
      </Modal>

      <Modal title="配置推送内容" width={820} open={pushOpen} confirmLoading={pushBusy} onCancel={() => setPushOpen(false)} onOk={createBatch} okText="保存推送批次" cancelText="取消">
        <Row gutter={[16, 8]}>
          <Col span={8}><Card size="small"><Statistic title="目标房屋" value={selectedIds.length} suffix="套" /></Card></Col>
          <Col span={8}><Card size="small"><Statistic title="当前页已显示号码" value={new Set(selectedRows.map((r) => r.mobileMasked).filter(Boolean)).size} /></Card></Col>
          <Col span={8}><Card size="small"><Statistic title="操作人" value="登录未接入" valueStyle={{ fontSize: 15 }} /></Card></Col>
        </Row>
        <Divider />
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div><Typography.Text>推送人群包名称 *</Typography.Text><Input value={pushName} onChange={(e) => setPushName(e.target.value)} maxLength={160} /></div>
          <div><Typography.Text>上传海报图片（可选）</Typography.Text><Row gutter={12} align="middle"><Col flex="120px">{posterData ? <img src={posterData} alt="海报预览" style={{ width: 108, maxHeight: 145, objectFit: 'contain', border: '1px solid #e4eaf1', borderRadius: 6 }} /> : <div style={{ width: 108, height: 100, display: 'grid', placeItems: 'center', color: '#8091a3', background: '#f6f9fc', border: '1px dashed #bfcfdf', borderRadius: 6 }}><FileImage size={24} /></div>}</Col><Col flex="auto"><Upload accept="image/png,image/jpeg,image/webp" maxCount={1} showUploadList={false} beforeUpload={async (file) => { try { setPosterData(await compressImage(file)); setPosterName(file.name); message.success('海报已加载'); } catch (e) { message.error((e as Error).message); } return false; }}><Button>选择海报</Button></Upload><Typography.Paragraph type="secondary" style={{ fontSize: 11, marginTop: 8 }}>{posterName || '支持 PNG / JPG / WEBP；图片会压缩后随批次记录。正式环境建议改为 OSS 对象存储。'}</Typography.Paragraph></Col></Row></div>
          <div><Typography.Text>推送文案 *</Typography.Text><Input.TextArea rows={4} maxLength={1200} showCount value={copy} onChange={(e) => setCopy(e.target.value)} /></div>
          <div><Typography.Text>触达渠道 *</Typography.Text><Checkbox.Group options={CHANNELS} value={channels} onChange={(values) => setChannels(values as string[])} /></div>
          <div><Typography.Text>本次人群筛选条件</Typography.Text><Input.TextArea rows={2} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></div>
          <Alert type="warning" showIcon message="此操作先创建可追溯的推送批次记录，不会直接调用短信 / 企微接口。待发送闸门、渠道回执及权限联调后，再接真实发送。" />
        </Space>
      </Modal>
    </Space>
  );
}
