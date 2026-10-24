import { createConnection } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { executeMysql } from '../../src/engines/mysql.ts';

// Needs a disposable MySQL, never a shared one. For example:
// The name and host port are unique per run, so parallel runs never collide:
//   name=dbq-nm-mysql-$$-$(date +%s)
//   docker run -d --rm --name "$name" -e MYSQL_ROOT_PASSWORD=pw -p 127.0.0.1::3306 mysql:8.4
//   port=$(docker port "$name" 3306 | head -n1 | cut -d: -f2)
//   DBQ_TEST_MYSQL_URI=mysql://root:pw@127.0.0.1:$port/mysql pnpm test
const uri = process.env.DBQ_TEST_MYSQL_URI;

describe.skipIf(!uri)('executeMysql against a real MySQL', () => {
  it('should be a query gone from the processlist after the timeout', async () => {
    const marker = `dbq_kill_${Date.now()}`;
    const plan = { statement: `SELECT SLEEP(5) AS ${marker}` } as never;

    await expect(
      executeMysql({ engine: 'mysql', uri: uri! } as never, plan, { limit: 10, timeoutMs: 1000, explain: false }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    const admin = await createConnection(uri!);
    try {
      const [rows] = await admin.query('SELECT id FROM information_schema.processlist WHERE info LIKE ?', [
        `%${marker}%`,
      ]);
      // The admin connection's own LIKE statement also contains the marker.
      expect((rows as unknown[]).length).toBe(1);
    } finally {
      await admin.end();
    }
  });
});
