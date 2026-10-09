/**
 * 14 个系统原因码的前端文案与分组（与后端 frequency.guard.ts ReasonCode 一一对应，
 * 人工中止不在此列：后端用 failReason=MANUAL_HALT 表达）。
 * 分组决定标签颜色：数据缺口=橙、频控=蓝、时段=青、名单=红、线索闸门=金、节假日=灰。
 */
export type ReasonGroup = 'lead' | 'data-gap' | 'optout' | 'frequency' | 'window' | 'holiday';

export const REASON_META: Record<string, { label: string; group: ReasonGroup; advice: string }> = {
  LEAD_PACKAGE_COOLDOWN: { label: '同包线索冷却', group: 'lead', advice: '业主近 90 天有同产品包线索，避免重复打扰' },
  LEAD_HOUSE_COOLDOWN: { label: '线索客户冷却', group: 'lead', advice: '业主近 15 天有任意有效线索，静默中' },
  NO_MOBILE: { label: '无手机号', group: 'data-gap', advice: '补号链路未覆盖该房屋，需推动数据源接入（GAP-1）' },
  OPT_OUT: { label: '已退订', group: 'optout', advice: '业主已主动退订，任何营销不得触达' },
  BLACKLIST: { label: '黑名单', group: 'optout', advice: '命中黑名单，禁止触达' },
  HOUSE_COOLDOWN: { label: '房屋冷却中', group: 'frequency', advice: '近 7 天已触达过任意营销内容' },
  PACKAGE_COOLDOWN: { label: '产品包冷却中', group: 'frequency', advice: '近 30 天已触达过同一产品包' },
  HOUSE_DAILY_CAP: { label: '触达日上限', group: 'frequency', advice: '当日触达已达 1 次上限' },
  HOUSE_WEEKLY_CAP: { label: '触达周上限', group: 'frequency', advice: '近 7 天触达已达 2 次上限' },
  HOUSE_MONTHLY_CAP: { label: '触达月上限', group: 'frequency', advice: '近 30 天触达已达 4 次上限' },
  GLOBAL_CAP_DEFERRED: { label: '全局上限顺延', group: 'frequency', advice: '当日全局 5000 条已满，顺延下一窗口' },
  OUT_OF_WINDOW: { label: '非发送时段顺延', group: 'window', advice: '仅 10:00-12:00 / 15:00-18:00 可发送，已顺延' },
  BLOCKED_WINDOW: { label: '禁发时段', group: 'window', advice: '22:00-次日08:00 为硬禁发时段' },
  HOLIDAY_SKIP: { label: '节假日跳过', group: 'holiday', advice: '节假日不发送（一期开关关闭，预留）' },
};

export const GROUP_COLOR: Record<ReasonGroup, string> = {
  lead: 'gold',
  'data-gap': 'orange',
  optout: 'red',
  frequency: '#1D5A96',
  window: 'cyan',
  holiday: 'default',
};

export const GROUP_LABEL: Record<ReasonGroup, string> = {
  lead: '线索闸门',
  'data-gap': '数据缺口',
  optout: '名单',
  frequency: '频控',
  window: '发送时段',
  holiday: '节假日',
};

export const STATUS_META: Record<string, { label: string; color: string }> = {
  queued: { label: '待发送', color: 'default' },
  sent: { label: '已发送', color: 'success' },
  failed: { label: '发送失败', color: 'error' },
  suppressed: { label: '已拦截', color: 'red' },
  deferred: { label: '已顺延', color: 'warning' },
};
