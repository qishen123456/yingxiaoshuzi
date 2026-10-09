import { useEffect, useState } from 'react';
import { App as AntApp, Button, Modal, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { GripVertical, Eye, Lock } from 'lucide-react';
import { api, type MappingRuleRow } from '../api';

const { Text } = Typography;

interface PreviewResult {
  matchedCount: number;
  samples: {
    houseId: string;
    communityName: string | null;
    houseName: string | null;
    region: string | null;
    city: string | null;
    hasMobile: boolean;
  }[];
}

/** 规则配置：priority 拖拽排序、启停（GAP-2 服务端兜底拦截）、命中预览。 */
export default function Rules() {
  const { message, modal } = AntApp.useApp();
  const [rules, setRules] = useState<MappingRuleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; result: PreviewResult } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .get<MappingRuleRow[]>('/rules')
      .then(setRules)
      .catch((e) => message.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const persistOrder = async (next: MappingRuleRow[]) => {
    const snapshot = rules;
    setRules(next); // 乐观更新
    try {
      await api.post('/rules/reorder', { orderedIds: next.map((r) => Number(r.id)) });
      message.success('优先级已保存（数值越小优先级越高）');
    } catch (e) {
      setRules(snapshot);
      message.error((e as Error).message);
    }
  };

  const toggleStatus = (row: MappingRuleRow, enabled: boolean) => {
    if (!enabled) {
      // 停用无需二次确认
      api
        .patch(`/rules/${row.id}/status`, { status: 'disabled' })
        .then(() => {
          message.success('规则已停用');
          load();
        })
        .catch((e) => message.error(e.message));
      return;
    }
    const blockedByGap = row.conditionJson.conditions.some((c) => c.tag === 'house_feature_tags');
    modal.confirm({
      title: `确认启用「${row.name}」？`,
      content: blockedByGap
        ? '该规则依赖的户型标签（house_feature_tags，浴缸有无）数据源尚未接入（DATA-CONTRACT GAP-2），启用将被系统拒绝。请先推动标签接入。'
        : '启用后将参与次日 07:30 跑批圈选。若规则依赖尚未接入的标签，服务端会拒绝启用。',
      okButtonProps: blockedByGap ? { danger: true } : undefined,
      onOk: () =>
        api
          .patch(`/rules/${row.id}/status`, { status: 'enabled' })
          .then(() => {
            message.success('规则已启用');
            load();
          })
          .catch((e) => message.error(e.message)),
    });
  };

  const openPreview = async (row: MappingRuleRow) => {
    try {
      const result = await api.post<PreviewResult>('/rules/preview', { conditionJson: row.conditionJson });
      setPreview({ name: row.name, result });
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const columns: ColumnsType<MappingRuleRow> = [
    {
      title: '排序',
      width: 48,
      render: (_, row) => (
        <GripVertical
          size={16}
          style={{ cursor: 'grab', color: dragId === row.id ? '#1D5A96' : '#bfbfbf' }}
        />
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      sorter: (a, b) => a.priority - b.priority,
      defaultSortOrder: 'ascend',
      render: (v: number) => <Text strong>{v}</Text>,
    },
    {
      title: '规则',
      dataIndex: 'name',
      render: (v: string, row) => (
        <span>
          {v}
          {/* GAP-2 未接入标签：常驻可见的缺口标记（数据源接入后删除此特判） */}
          {row.conditionJson.conditions.some((c) => c.tag === 'house_feature_tags') && (
            <Tag color="orange" style={{ marginLeft: 8 }}>
              依赖标签未接入（GAP-2）
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: '产品包',
      width: 160,
      render: (_, r) => (r.package ? <Tag color="#1D5A96">{r.package.name}</Tag> : r.packageId),
    },
    {
      title: '状态',
      width: 110,
      render: (_, row) => (
        <Switch
          checked={row.status === 'enabled'}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={(v) => toggleStatus(row, v)}
        />
      ),
    },
    {
      title: '命中预览',
      width: 110,
      render: (_, row) => (
        <Button size="small" icon={<Eye size={14} />} onClick={() => openPreview(row)}>
          预览
        </Button>
      ),
    },
  ];

  return (
    <>
      <Typography.Paragraph type="secondary">
        <Lock size={13} style={{ verticalAlign: -2 }} /> 拖拽行首手柄调整优先级（互斥组内单包收敛，数值越小越优先）；
        依赖未接入标签的规则（如浴改淋依赖 GAP-2 浴缸户型标签）无法启用，服务端会直接拒绝。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rules}
        pagination={false}
        rowClassName={(row) => (row.status === 'disabled' ? 'rule-row-disabled' : '')}
        onRow={(row) => ({
          draggable: true,
          onDragStart: () => setDragId(row.id),
          onDragEnd: () => setDragId(null),
          onDragOver: (e) => e.preventDefault(),
          onDrop: () => {
            if (!dragId || dragId === row.id) return;
            const next = [...rules];
            const from = next.findIndex((r) => r.id === dragId);
            const to = next.findIndex((r) => r.id === row.id);
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            persistOrder(next);
          },
        })}
      />
      <Modal
        open={!!preview}
        title={`命中预览：${preview?.name ?? ''}`}
        footer={null}
        onCancel={() => setPreview(null)}
        width={720}
      >
        {preview && (
          <>
            <Typography.Paragraph>
              当前快照命中 <Text strong type="danger">{preview.result.matchedCount}</Text> 套房屋（脱敏样本，最多 20 条）
            </Typography.Paragraph>
            <Table
              size="small"
              rowKey="houseId"
              pagination={false}
              dataSource={preview.result.samples}
              columns={[
                { title: '项目', dataIndex: 'communityName' },
                { title: '房屋', dataIndex: 'houseName' },
                { title: '城市', dataIndex: 'city' },
                {
                  title: '号码',
                  dataIndex: 'hasMobile',
                  width: 90,
                  render: (v: boolean) => (v ? <Tag color="green">有</Tag> : <Tag color="orange">无</Tag>),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </>
  );
}
