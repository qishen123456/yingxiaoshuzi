import { Injectable } from '@nestjs/common';
import { POSTER_TEMPLATE_SPEC } from './poster.slot-dict';

/**
 * 海报渲染（ADR-006：模板套版 + 变量填充；docs/POSTER-TEMPLATE-SPEC.md）。
 * 本服务只产出最终 SVG 字符串（变量填充、痛点词稳定选取、社会证明红线）；
 * 位图 PNG 合成（背景图/小程序码叠加 + Sharp 光栅化）与 OSS 上传在通道拉通阶段接入，
 * 不在此引入原生二进制依赖，保证骨架环境零编译可运行。
 */

interface SvgSpec {
  canvas: { width: number; height: number };
  slots: Record<string, unknown>;
}

export interface PosterVariables {
  /** 房屋痛点词库命中值（取房屋实际标签，如「墙面发霉」）；无命中时由词库兜底 */
  painHits?: string[];
  /** 项目真实完成户数；<20 必须降级通用话术，禁止编造数字 */
  communityDoneCount?: number;
  /** 项目通用话术（无真实户数时使用） */
  fallbackSocialProof?: string;
}

@Injectable()
export class PosterService {
  /** 稳定哈希（FNV-1a）：同一房屋每次选词一致，避免相邻两次跑批文案跳变。 */
  private hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** 痛点条文案：优先用房屋真实标签与词库的交集；否则按 houseId 哈希在词库中稳定选一条。 */
  resolvePainStrip(houseId: string, painWords: string[], painHits?: string[]): string {
    const hit = painHits?.find((w) => painWords.includes(w));
    if (hit) return hit;
    return painWords[this.hash(houseId) % painWords.length];
  }

  /** 社会证明红线：真实户数不足 20 时降级通用话术（规格：禁止展示不可核验数字）。 */
  resolveSocialProof(spec: PosterVariables): string | null {
    if (typeof spec.communityDoneCount === 'number' && spec.communityDoneCount >= 20) {
      return `已有${spec.communityDoneCount}户邻居选择`;
    }
    return spec.fallbackSocialProof ?? null;
  }

  /** 基于 svg_spec 生成最终 SVG（槽位字典冻结键名见 poster.slot-dict.ts）。 */
  render(houseId: string, packageCode: string, spec: SvgSpec, vars: PosterVariables): string {
    const dict = POSTER_TEMPLATE_SPEC.painWords[packageCode];
    const slots = { ...spec.slots } as Record<string, unknown>;
    if (dict) {
      slots.pain_strip_text = this.resolvePainStrip(houseId, dict, vars.painHits);
    }
    const social = this.resolveSocialProof(vars);
    if (social !== null) slots.social_proof = social;
    if (social === null) delete slots.social_proof;

    // 占位 SVG：仅用于 dry-run 联调与模板预览；正式版由 Sharp 以 background_oss_key 合成
    const { width, height } = spec.canvas;
    const text = (y: number, content: string, size = 30, color = '#FFFFFF') =>
      `<text x="60" y="${y}" font-size="${size}" fill="${color}">${content}</text>`;
    const lines = [
      text(120, String(slots.pain_strip_text ?? ''), 34),
      text(220, `${String(slots.headline_prefix ?? '')}${String(slots.headline_highlight ?? '')}`),
      text(300, String(slots.material_brand ?? ''), 28, '#F5D7A0'),
      text(360, String(slots.trust_text ?? '')),
      text(420, String(slots.cta_title ?? '')),
    ];
    if (slots.social_proof) lines.push(text(480, String(slots.social_proof)));

    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<rect width="${width}" height="${height}" fill="#1D5A96"/>` +
      lines.join('') +
      `</svg>`
    );
  }
}
