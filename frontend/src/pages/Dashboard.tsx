import { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Tag, Typography, Alert, Space } from 'antd';
import {
  Database,
  Phone,
  Radar,
  Send,
  ShieldBan,
  UserSearch,
  CircleCheck,
  CircleAlert,
} from 'lucide-react';
import { api, type Overview } from '../api';

const { Text } = Typography;

/** 运营看板：数据就绪 + 触达漏斗 + 线索与归因。 */
export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<Overview>('/analytics/overview')
      .then(setData)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  if (error) return <Alert type="error" showIcon message="看板数据加载失败" description={error} />;
  if (!data) return <Text type="secondary">加载中…</Text>;

  const { readiness: r, push, leads } = data;
  const sent = push.sent ?? 0;
  const suppressed = push.suppressed ?? 0;
  const deferred = push.deferred ?? 0;
  const failed = push.failed ?? 0;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small" title="数据就绪（跑批前置）">
        <Row gutter={[16, 12]}>
          <Col>
            <StateIcon ok={r.labelReady} /> 房屋标签：
            {r.labelReady ? (
              <Text strong>已就绪（{r.labelStatDate}）</Text>
            ) : (
              <Text strong type="danger">
                未就绪（最新 {r.labelStatDate ?? '无数据'}）
              </Text>
            )}
          </Col>
          <Col>
            <StateIcon ok={r.leadReady} /> 线索闸门：
            <Tag color={r.leadGateState === 'active' ? 'green' : r.leadGateState === 'bypassed_open' ? 'gold' : 'default'}>
              {r.leadGateState === 'active'
                ? `正常（延迟 ${r.leadLagDays} 天）`
                : r.leadGateState === 'bypassed_open'
                  ? `数据过期 fail-open（延迟 ${r.leadLagDays} 天）`
                  : '无线索数据'}
            </Tag>
          </Col>
          <Col>
            <StateIcon ok={r.mobileReady} /> 号码覆盖率：
            <Text strong={r.mobileReady} type={r.mobileReady ? undefined : 'danger'}>
              {r.mobileCoverage === null ? '无房屋数据' : `${(r.mobileCoverage * 100).toFixed(1)}%`}
            </Text>
            <Text type="secondary">
              （{r.mobileHouses}/{r.totalHouses} 套，门槛 70%）
            </Text>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="已发送（dry-run 模拟）" value={sent} prefix={<Send size={18} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="频控/名单拦截" value={suppressed} prefix={<ShieldBan size={18} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="时段顺延" value={deferred} prefix={<CircleAlert size={18} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="发送失败" value={failed} prefix={<CircleAlert size={18} />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="线索总量" value={leads.total} prefix={<UserSearch size={18} />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="已归因线索" value={leads.attributed} prefix={<Radar size={18} />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={<><Database size={14} /> 线索来源</>} size="small">
            <Space wrap>
              <Tag color="#1D5A96">external {leads.bySource.external ?? 0}</Tag>
              <Tag color="gold">inferred {leads.bySource.inferred ?? 0}</Tag>
              <Tag>none {leads.bySource.none ?? 0}</Tag>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Phone size={13} /> 质量分布：
              {Object.entries(leads.byQuality).map(([q, n]) => (
                <Tag key={q} color={q === 'A' ? 'green' : undefined}>
                  {q} {n}
                </Tag>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function StateIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CircleCheck size={15} color="#389e0d" style={{ verticalAlign: -2, marginRight: 4 }} />
  ) : (
    <CircleAlert size={15} color="#cf1322" style={{ verticalAlign: -2, marginRight: 4 }} />
  );
}
