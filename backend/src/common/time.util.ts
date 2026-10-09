/**
 * 发送时间窗口工具（ARCHITECTURE §8 闸门 9/10）。
 * 禁发时段 22:00–次日 08:00 为代码级常量，不入库、不可配、不可关。
 */

export const BLOCKED_START_HOUR = 22;
export const BLOCKED_END_HOUR = 8;
const BUSINESS_TZ = 'Asia/Shanghai';

/** 取某时刻在上海时区的「时:分」绝对分钟数（窗口判定一律按上海墙上时间，不依赖进程 TZ）。 */
function shanghaiMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return hour * 60 + minute;
}

/** 是否落在禁发时段 [22:00, 次日08:00)（上海时间）。 */
export function isInBlockedWindow(d: Date = new Date()): boolean {
  const m = shanghaiMinutes(d);
  return m >= BLOCKED_START_HOUR * 60 || m < BLOCKED_END_HOUR * 60;
}

export interface TimeWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

/** 当前时刻是否落在任一可发送时段内（含端点，按同日区间，不支持跨 0 点段）。 */
export function isInSendWindows(d: Date = new Date(), windows: TimeWindow[]): boolean {
  const cur = shanghaiMinutes(d);
  return windows.some((w) => cur >= w.startHour * 60 + w.startMinute && cur <= w.endHour * 60 + w.endMinute);
}

/**
 * 计算下一个可发送窗口的起点时刻（用于 OUT_OF_WINDOW 顺延，调用方只取其上海自然日）。
 * 今天剩余窗口取最近一个，否则取明天第一个窗口。
 */
export function nextWindowStart(d: Date, windows: TimeWindow[]): Date {
  const cur = shanghaiMinutes(d);
  const sorted = [...windows].sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute));
  const laterToday = sorted.find((w) => w.startHour * 60 + w.startMinute > cur);
  const day = shanghaiCalendarDay(d);
  if (laterToday) {
    return new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), laterToday.startHour - 8, laterToday.startMinute),
    );
  }
  const first = sorted[0];
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, first.startHour - 8, first.startMinute),
  );
}

/**
 * 从 Prisma 窗口行构造内部窗口对象。
 * 关键：PostgreSQL `time without time zone` 经 Prisma 读回为 UTC 的 Date，
 * 业务时间 10:00 存的是 1970-01-01T10:00:00Z，必须用 getUTC* 取小时，用 getHours 会偏 +8。
 * day_type=all 为骨架唯一支持；weekend/weekday 为 P1。
 */
export function toTimeWindow(rows: { dayType: string; windowStart: Date; windowEnd: Date; enabled: boolean }[]): TimeWindow[] {
  return rows
    .filter((r) => r.enabled && r.dayType === 'all')
    .map((r) => ({
      startHour: r.windowStart.getUTCHours(),
      startMinute: r.windowStart.getUTCMinutes(),
      endHour: r.windowEnd.getUTCHours(),
      endMinute: r.windowEnd.getUTCMinutes(),
    }));
}

/** 近 N 天起点（用于冷却/上限回看）。 */
export function daysAgo(days: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d;
}

/** 当日 00:00（进程本地时区，容器 TZ=Asia/Shanghai）。 */
export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * 取某时刻在上海时区的「自然日」，并表示为该日 UTC 00:00 的 Date。
 * 背景：Prisma 对 PostgreSQL `date` 列（@db.Date）统一按 UTC 日历日编解码，
 * 与数据库会话 timezone 无关；直接传本地午夜会在东八区被存成前一天。
 * 所有写 stat_date / deferred_until 等 date 列的地方必须经此函数转换。
 */
export function shanghaiCalendarDay(d: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/** date 列读回值（UTC 午夜）格式化为 YYYY-MM-DD（即上海自然日，前提是写入走 shanghaiCalendarDay）。 */
export function formatDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
