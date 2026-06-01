import express from "express";
import { handleOtelTraces } from "./otel.js";
import { handleCommitHook } from "./webhook.js";
import { renderDashboard } from "./dashboard.js";
import { getDashboardMetrics } from "../db/queries.js";
import { getDb, closeDb } from "../db/schema.js";

const PORT = parseInt(process.env["CODEGOV_PORT"] ?? "4318", 10);

export function startServer(port = PORT): void {
  getDb();

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.post("/v1/traces", handleOtelTraces);
  app.post("/v1/hooks/commit", handleCommitHook);

  app.get("/dashboard", (req, res) => {
    const days = parseInt(req.query["days"] as string, 10) || 30;
    res.type("html").send(renderDashboard(days));
  });

  app.get("/api/metrics", (req, res) => {
    const days = parseInt(req.query["days"] as string, 10) || 30;
    res.json(getDashboardMetrics(days));
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  app.get("/", (_req, res) => {
    res.redirect("/dashboard");
  });

  // Bind to loopback only. The dashboard and ingest endpoints are
  // unauthenticated; they should not be reachable from the network by default.
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`CodeGov server running on http://localhost:${port}`);
    console.log(`  Dashboard:    http://localhost:${port}/dashboard`);
    console.log(`  OTEL traces:  POST http://localhost:${port}/v1/traces`);
    console.log(`  Git hooks:    POST http://localhost:${port}/v1/hooks/commit`);
    console.log(`  API:          GET  http://localhost:${port}/api/metrics`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    server.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
