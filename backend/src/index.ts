import { createPoller } from "./app/poller";
import { createServer } from "./http/server";
import { loadConfig } from "./infra/config";
import { createStore } from "./infra/store";

async function main() {
  const config = await loadConfig();
  const store = await createStore(config.dataDir);
  const poller = createPoller(config.apps, store, config.pollIntervalMs);
  const server = createServer({ store, apps: config.apps });

  poller.start();
  await server.start(config.port);
  console.log(`Listening on http://localhost:${config.port} ☕️`);

  async function shutdown(signal: string): Promise<void> {
    console.log(`\nReceived ${signal}, shutting down...`);
    poller.stop();
    await server.stop();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
