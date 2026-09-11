import { loadConfig } from "./config/env.js";
import { compose } from "./composition.js";
import { startTracing, stopTracing } from "./adapters/observability/otel-sdk.js";

const config = loadConfig();

// Inicializar tracing ANTES de crear spans (antes de compose).
// Si OTEL_EXPORTER_OTLP_ENDPOINT no está seteado, startTracing es noop (tracing inerte).
startTracing(config.otelExporterEndpoint);

const { app, db } = compose(config);

// Manejo de señales de cierre graceful
const shutdown = async () => {
  await app.close();
  await db.destroy();
  await stopTracing();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
