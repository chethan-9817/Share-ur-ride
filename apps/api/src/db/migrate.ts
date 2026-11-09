import { env } from '../config/env';
import { closeDb, initDb, migrateDb } from './client';

/** CLI: `npm run db:migrate` — applies pending SQL migrations from ./drizzle. */
async function main() {
  await initDb(env.DATABASE_URL);
  await migrateDb();
  await closeDb();
  console.log('✔ migrations applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
