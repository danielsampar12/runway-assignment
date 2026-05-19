import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "../domain/types";
import type { Store } from "../infra/store";

export interface Server {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

export interface ServerDeps {
  store: Store;
  apps: AppConfig[];
}

export function createServer({ store, apps }: ServerDeps): Server {
  const fastify = Fastify({ logger: true });

  fastify.register(cors, { origin: true });

  fastify.get("/health", async () => ({ ok: true }));

  fastify.get("/apps", async () => apps);

  fastify.get<{
    Params: { appId: string };
    Querystring: { windowHours?: string };
  }>("/apps/:appId/reviews", async (req, reply) => {
    const { appId } = req.params;

    const app = apps.find((a) => a.id === appId);
    if (!app) {
      return reply.code(404).send({ error: `Unknown appId: ${appId}` });
    }

    const windowHours = Number(req.query.windowHours ?? 48);
    if (!Number.isFinite(windowHours) || windowHours <= 0) {
      return reply.code(400).send({ error: "windowHours must be a positive number" });
    }

    const all = await store.read(appId);
    const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
    return all.filter((r) => Date.parse(r.submittedAt) >= cutoff);
  });

  return {
    start: async (port) => {
      // Bind to 0.0.0.0 so the frontend container (or any host on the same
      // network) can reach the server. Fastify defaults to loopback otherwise.
      await fastify.listen({ port, host: "0.0.0.0" });
    },
    stop: () => fastify.close(),
  };
}
