import { useEffect, useState } from 'react';
import { App as AntApp, Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, type TagAdminRow } from '../api';

const GROUPS = [
  { label: '水路维修', value: 'water' }, { label: '电路维修', value: 'electric' },
  { label: '家电维修', value: 'appliance' }, { label: '环境 / 墙面', value: 'env' },
  { label: '价格偏好', value: 'price' }, { label: '居住状态', value: 'residence' },
  { label: '家庭结构', value: 'family' }, { label: '装修状态', value: 'decoration' },
  { label: '房屋属性', value: 'house' }, { label: '其他', value: 'other' },
];
const TYPES = [
  { label: '多选枚举', value: 'multi_enum' }, { label: '单选枚举', value: 'enum' },
  { label: '文本', value: 'string' }, { label: '数值', value: 'number' }, { label: '布尔', value: 'boolean' },
];
export default function TagMaintenance() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<TagAdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TagAdminRow | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = () => { setLoading(true); api.get<TagAdminRow[]>('/tags/admin').then(setRows).catch((e) => message.error(e.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  const startEdit = (row?: TagAdminRow) => {
    setEditing(row ?? null);
    form.setFieldsValue({
      tagKey: row?.tagKey ?? '', tagName: row?.tagName ?? '', tagGroup: row?.tagGroup ?? 'other',
      valueType: row?.valueType ?? 'multi_enum', sourceColumn: row?.sourceColumn ?? '',
      ruleEnabled: row?.ruleEnabled ?? false, enumValues: (row?.enumValues ?? []).join('\n'),
      notes: '',
    });
    setOpen(true);
  };
  const save = async () => {
    const values = await form.validateFields();
    const body = {
      tagKey: String(values.tagKey).trim(), tagName: String(values.tagName).trim(),
      tagGroup: values.tagGroup, valueType: values.valueType,
      sourceColumn: String(values.sourceColumn ?? '').trim() || null,
      ruleEnabled: !!values.ruleEnabled,
      enumValues: String(values.enumValues ?? '').split(/[\n，,]/).map((v) => v.trim()).filter(Boolean),
    };
    try {
      if (editing) await api.patch('/tags/admin/' + encodeURIComponent(editing.tagKey), body);
      else await api.post('/tags/admin', body);
      message.success('标签配置已保存到数据库'); setOpen(false); load();
    } catch (e) { message.error((e as Error).message); }
  };
  const columns: ColumnsType<TagAdminRow> = [
    { title: '标签名称', dataIndex: 'tagName', render: (v: string, row) => <><Typography.Text strong>{v}</Typography.Text><div style={{ color: '#8996a6', fontSize: 10 }}>{row.tagKey}</div></> },
    { title: '类别', dataIndex: 'tagGroup', render: (v: string) => GROUPS.find((g) => g.value === v)?.label ?? v },
    { title: '源字段', dataIndex: 'sourceColumn', render: (v: string | null) => v || <Tag color="orange">待数据接入</Tag> },
    { title: '类型', dataIndex: 'valueType', render: (v: string) => TYPES.find((t) => t.value === v)?.label ?? v },
    { title: '可选值', dataIndex: 'enumValues', render: (v: string[]) => <Space wrap size={[4, 4]}>{(v ?? []).slice(0, 8).map((x) => <Tag key={x}>{x}</Tag>)}{(v ?? []).length > 8 && <Tag>+{v.length - 8}</Tag>}</Space> },
    { title: '规则状态', dataIndex: 'ruleEnabled', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '可用于规则' : '未开放'}</Tag> },
    { title: '操作', width: 90, render: (_, row) => <Button size="small" onClick={() => startEdit(row)}>编辑</Button> },
  ];
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      <div><Typography.Title level={3} style={{ margin: 0 }}>标签维护</Typography.Title><Typography.Paragraph type="secondary" style={{ margin: '5px 0 0' }}>直接维护研选数据库中的 tag_dictionary / tag_value。未接入上游物理字段的标签不会自动参与规则命中。</Typography.Paragraph></div>
      <Button type="primary" onClick={() => startEdit()}>＋ 新增标签</Button>
    </div>
    <Alert type="info" showIcon message="维护边界" description="新增已有字段下的枚举值可在这里维护；新增上游从未接入的物理字段，还必须由数据开发完成取数、字段映射和验数后才能开放给规则使用。" />
    <Table rowKey="tagKey" loading={loading} dataSource={rows} columns={columns} pagination={{ pageSize: 10, showTotal: (t) => '共 ' + t + ' 个标签' }} />
    <Modal title={editing ? '编辑标签' : '新增标签'} open={open} onCancel={() => setOpen(false)} onOk={save} okText="保存到数据库" cancelText="取消" width={680}>
      <Form form={form} layout="vertical">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item name="tagKey" label="内部标签编码" rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_]{1,63}$/, message: '使用小写字母、数字和下划线，并以字母开头' }]}><Input disabled={!!editing} placeholder="house_feature_tags" /></Form.Item>
          <Form.Item name="tagName" label="标签名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="tagGroup" label="标签类别" rules={[{ required: true }]}><Select options={GROUPS} /></Form.Item>
          <Form.Item name="valueType" label="数据类型" rules={[{ required: true }]}><Select options={TYPES} /></Form.Item>
          <Form.Item name="sourceColumn" label="上游源字段"><Input placeholder="如 env_tags_raw；未接入请留空" /></Form.Item>
          <Form.Item name="ruleEnabled" label="开放给规则引擎" valuePropName="checked"><Switch checkedChildren="开放" unCheckedChildren="关闭" /></Form.Item>
        </div>
        <Form.Item name="enumValues" label="枚举值（每行一个，旧值删除后会保留为停用）"><Input.TextArea rows={5} placeholder={'卫生间漏水\n厨房漏水\n阳台漏水'} /></Form.Item>
        <Alert type="warning" showIcon message="变更枚举值会影响现有规则的命中范围，请先核对相关产品映射规则。" />
      </Form>
    </Modal>
  </Space>;
}
