/**
 * 种子 SQL 执行器：按序执行仓库根 sql/01..05（幂等，可重复执行）。
 * 前置：先 `npm run db:push` 建好 Prisma 16 张业务表+3 张 staging 表。
 * 用法：npm run seed:sql
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const SQL_DIR = resolve(__dirname, '../../sql');

const SEED_FILES = [
  '01_tag_dictionary_seed.sql',
  '02_catalog_seed.sql',
  '03_mapping_rule_seed.sql',
  '04_frequency_seed.sql',
  '05_poster_template_seed.sql',
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('缺少 DATABASE_URL，请先复制 .env.example 为 .env（或 export 环境变量）');
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of SEED_FILES) {
      const full = resolve(SQL_DIR, file);
      const sql = await readFile(full, 'utf8');
      process.stdout.write(`执行 ${file} ... `);
      // pg simple query 协议支持多语句；种子均为幂等 ON CONFLICT/IF NOT EXISTS
      await client.query(sql);
      console.log('OK');
    }
    console.log('全部种子 SQL 执行完成');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('种子执行失败：', err);
  process.exit(1);
});
