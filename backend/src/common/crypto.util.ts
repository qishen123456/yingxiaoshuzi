import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * 手机号与客户键工具（ADR-013）。
 * 铁律：
 *  - 明文手机号只允许出现在同步管道/staging；merge 后立即清空；
 *  - customer_key_hash = HMAC-SHA256(normalize(mobile), 固定密钥)，
 *    lead_record / push_detail / house_label_snapshot / house_mobile_resolve 必须同算法同密钥；
 *  - 号码密文用 AES-256-GCM（随机 IV，不可用于 join，仅下发时解密）。
 */

/** 归一化：去空白与连字符，去 +86 / 86 前缀，返回 11 位大陆手机号；不合规返回 null。 */
export function normalizeMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s-]/g, '');
  if (s.startsWith('+86')) s = s.slice(3);
  else if (s.startsWith('86') && s.length === 13) s = s.slice(2);
  if (/^1\d{10}$/.test(s)) return s;
  return null;
}

/** 确定性客户键：归一化手机号的 HMAC-SHA256（hex）。无手机号返回 null。 */
export function hmacCustomerKey(raw: string | null | undefined, secret: string): string | null {
  const mobile = normalizeMobile(raw);
  if (!mobile) return null;
  return createHmac('sha256', secret).update(mobile, 'utf8').digest('hex');
}

/** 界面/日志展示用脱敏号：138****5678。 */
export function maskMobile(raw: string | null | undefined): string | null {
  const mobile = normalizeMobile(raw);
  if (!mobile) return null;
  return `${mobile.slice(0, 3)}****${mobile.slice(7)}`;
}

/** AES-256-GCM 加密，输出 base64(iv[12] | tag[16] | ciphertext)。 */
export function encryptMobile(raw: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** AES-256-GCM 解密；数据被篡改或密钥不符时抛错（调用方需捕获并按通道失败处理）。 */
export function decryptMobile(payload: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
