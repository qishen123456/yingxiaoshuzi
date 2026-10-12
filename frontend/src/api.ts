/** 后端 API 统一封装（开发期经 vite proxy 转发到 :3000）。 */

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // 后端 ValidationPipe / 业务异常均为 { message, statusCode } 结构
    const message = typeof body?.message === 'string' ? body.message : body?.message?.join?.('；') ?? `请求失败（${res.status}）`;
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
};

export interface Readiness {
  labelReady: boolean;
  labelStatDate: string | null;
  leadReady: boolean;
  leadSyncedAt: string | null;
  leadLagDays: number | null;
  mobileCoverage: number | null;
  mobileReady: boolean;
  totalHouses: number;
  mobileHouses: number;
  leadGateState: 'active' | 'bypassed_open' | 'unavailable';
}

export interface Overview {
  readiness: Readiness;
  push: Record<string, number>;
  leads: {
    total: number;
    attributed: number;
    bySource: Record<string, number>;
    byQuality: Record<string, number>;
  };
}

export interface MappingRuleRow {
  id: string;
  name: string;
  packageId: string;
  priority: number;
  mutexGroupId: string | null;
  conditionJson: { logic: 'AND' | 'OR'; conditions: { tag: string; op: string; value?: unknown }[] };
  status: 'enabled' | 'disabled';
  remark: string | null;
  package?: { id: string; code: string; name: string };
}

export interface CampaignTaskRow {
  id: string;
  statDate: string;
  status: string;
  leadGateState: string;
  scannedCount: number;
  matchedCount: number;
  suppressedCount: number;
  queuedCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PushRecordRow {
  id: string;
  pushTaskId: string;
  status: string;
  reasonCode: string | null;
  package: { name: string; code: string } | null;
  communityName: string | null;
  houseName: string | null;
  city: string | null;
  mobileMasked: string | null;
  sentAt: string | null;
  failReason: string | null;
  deferredUntil: string | null;
  createdAt: string;
}


export interface ProjectCatalogRow {
  city: string;
  projectId: string;
  projectName: string;
}
export interface HouseListItem {
  houseId: string;
  houseName: string | null;
  communityId: string | null;
  communityName: string | null;
  city: string | null;
  region: string | null;
  ownerNameMasked: string | null;
  mobileMasked: string | null;
  hasMobile: boolean;
  statDate: string;
  syncedAt: string;
  labels: Record<string, unknown>;
  matchedProducts: { id: string; code: string; name: string }[];
  winningPackage: { id: string; code: string; name: string } | null;
  winningRuleId: string | null;
  leadCount: number;
  openLeadCount: number;
  lastPushAt: string | null;
  lastPushStatus: string | null;
}
export interface HouseSearchResponse {
  total: number;
  candidateCount: number;
  page: number;
  pageSize: number;
  scanLimitReached: boolean;
  items: HouseListItem[];
}
export interface TagAdminRow {
  id: string | number;
  tagKey: string;
  tagGroup: string;
  tagName: string;
  valueType: string;
  sourceColumn: string | null;
  ruleEnabled: boolean;
  enumValues: string[];
  dataReady: boolean;
  values?: { tagValue: string; status: string; sortOrder: number }[];
}
export interface AudiencePackageRow {
  id: string;
  name: string;
  criteria: string | null;
  createdBy: string;
  status: string;
  houseCount: number;
  uniquePhoneCount: number;
  createdAt: string;
}
export interface AudiencePackageDetail extends AudiencePackageRow {
  houseIds: string[];
  houses: HouseListItem[];
}
export interface MarketingPushBatchRow {
  id: string;
  audiencePackageId: string | null;
  packageName: string;
  sender: string;
  channels: string[];
  criteria: string | null;
  houseCount: number;
  uniquePhoneCount: number;
  posterName: string | null;
  status: string;
  createdAt: string;
}
export interface MarketingPushBatchDetail extends MarketingPushBatchRow {
  contentSnapshot: string;
  posterData: string | null;
  houses: HouseListItem[];
}
export interface PosterTemplateRow {
  id: string;
  name: string;
  packageId: string | null;
  package: { id: string; code: string; name: string } | null;
  width: number;
  height: number;
  backgroundOssKey: string | null;
  previewData: string | null;
  svgSpec: unknown;
  status: string;
}
