/**
 * 海报槽位字典（与 docs/POSTER-TEMPLATE-SPEC.md 冻结键名一致）。
 * 痛点词库与种子 svg_spec.rules 注释保持同源；改词库 = 改版本，需同步规格文档。
 */
export const POSTER_TEMPLATE_SPEC = {
  canvas: { width: 750, height: 1600 },
  /** 社会证明红线：项目真实完成户数低于该值时禁止出现数字 */
  socialProofMinHouses: 20,
  painWords: {
    'PKG-SEEP': ['墙根发霉', '门口发黑', '地漏反味'],
    'PKG-TUB2SHOWER': ['浴缸空着', '收纳不足', '早高峰抢不停'],
    'PKG-REFRESH': ['旧墙掉皮', '发霉发黑', '污渍难擦'],
  } as Record<string, string[]>,
};
