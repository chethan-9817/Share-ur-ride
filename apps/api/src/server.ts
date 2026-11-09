import { buildApp } from './app';
import { env } from './config/env';
import { closeDb, initDb, migrateDb } from './db/client';
import { seed } from './db/seed';
import { createGateway } from './realtime/gateway';
import { startScheduler, stopScheduler } from './services/scheduler';
import { initSimulator, stopAllDrives } from './services/simulator';

async function main() {
  await initDb(env.DATABASE_URL);
  await migrateDb();
  // Idempotent: only inserts hubs / demo accounts that don't exist yet.
  await seed({ quiet: true });

  const { app, origins } = await buildApp();
  await app.ready();
  const io = createGateway(app, origins);
  initSimulator(app.log);
  startScheduler(app.log);

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`🚖 ArriveShare API on http://localhost:${env.PORT}  ·  docs at /docs`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down`);
    stopScheduler();
    stopAllDrives();
    io.close();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
