import { formatToonValue, type Envelope } from '../src/output/envelope.ts';

const samples: { name: string; engine: Envelope['engine']; rows: unknown[]; cursor?: string }[] = [
  {
    name: 'Mongo find · 20 documents',
    engine: 'mongodb',
    rows: Array.from({ length: 20 }, (_, index) => ({
      _id: `id-${index + 1}`,
      name: `Record ${String(index + 1).padStart(3, '0')}`,
      status: index % 3 === 0 ? 'inactive' : 'active',
    })),
  },
  {
    name: 'Mongo aggregate · grouped counts',
    engine: 'mongodb',
    rows: [
      { _id: 'active', count: 14 },
      { _id: 'inactive', count: 6 },
    ],
  },
  {
    name: 'SQL SELECT · 50 rows',
    engine: 'mysql',
    rows: Array.from({ length: 50 }, (_, index) => ({
      id: index + 1,
      company_id: 100 + (index % 9),
      status: index % 2 === 0 ? 'open' : 'closed',
      total: (index + 1) * 10,
    })),
  },
  {
    name: 'SQL EXPLAIN · 2 plan rows',
    engine: 'mysql',
    rows: [
      { id: 1, select_type: 'SIMPLE', table: 'orders', type: 'range', rows: 42, Extra: 'Using where' },
      { id: 1, select_type: 'SIMPLE', table: 'companies', type: 'eq_ref', rows: 1, Extra: 'Using index' },
    ],
  },
  {
    name: 'Redis SCAN · 20 keys',
    engine: 'redis',
    cursor: '42',
    rows: Array.from({ length: 20 }, (_, index) => ({
      key: `cache:item:${index + 1}`,
      type: index % 2 === 0 ? 'string' : 'hash',
      ttl: 300 + index,
    })),
  },
];

const envelope = (engine: Envelope['engine'], rows: unknown[], cursor?: string): Envelope => ({
  project: 'fixture',
  env: 'test',
  db: 'sample',
  engine,
  rowCount: rows.length,
  truncated: false,
  ...(cursor === undefined ? {} : { cursor }),
  elapsedMs: 12,
  rows,
});

let beforeTotal = 0;
let afterTotal = 0;
console.log('| Fixture | JSON chars | TOON chars | JSON tokens¹ | TOON tokens¹ | Savings |');
console.log('|---|---:|---:|---:|---:|---:|');

for (const sample of samples) {
  const value = envelope(sample.engine, sample.rows, sample.cursor);
  const before = JSON.stringify(value, null, 2).length;
  const after = formatToonValue(value).length;
  const beforeTokens = Math.ceil(before / 4);
  const afterTokens = Math.ceil(after / 4);
  const savings = ((1 - afterTokens / beforeTokens) * 100).toFixed(1);
  beforeTotal += beforeTokens;
  afterTotal += afterTokens;
  console.log(`| ${sample.name} | ${before} | ${after} | ${beforeTokens} | ${afterTokens} | ${savings}% |`);
}

console.log(`| **Average** | — | — | **${Math.ceil(beforeTotal / samples.length)}** | **${Math.ceil(afterTotal / samples.length)}** | **${((1 - afterTotal / beforeTotal) * 100).toFixed(1)}%** |`);
console.log('\n¹ Estimate: character count divided by four, rounded up.');
