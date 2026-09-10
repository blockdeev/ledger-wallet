/**
 * Bootstrap del SDK de OpenTelemetry (Fase 6).
 *
 * Inicializa el NodeSDK con un Resource identificado como "ledger-wallet" y un
 * exporter OTLP HTTP hacia el endpoint configurado por env.
 *
 * Si NO se provee endpoint (ver `otelExporterEndpoint` en config/env.ts), el SDK
 * NO se inicializa y el tracing queda INERTE: el API de OTel actúa como noop y
 * la app funciona exactamente igual sin un collector corriendo.
 *
 * Ver ADR 0014 para el razonamiento de diseño.
 */

import { createRequire } from "module";

// Los paquetes OTel son CJS; se importan vía createRequire para compatibilidad con ESM strict.
// createRequire no activa la regla no-require-imports (no es un require() directo).
const require = createRequire(import.meta.url);

const { NodeSDK } = require("@opentelemetry/sdk-node") as typeof import("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http") as typeof import("@opentelemetry/exporter-trace-otlp-http");
const { resourceFromAttributes } = require("@opentelemetry/resources") as typeof import("@opentelemetry/resources");
const { ATTR_SERVICE_NAME } = require("@opentelemetry/semantic-conventions") as typeof import("@opentelemetry/semantic-conventions");

let sdk: InstanceType<typeof NodeSDK> | undefined;

/**
 * Inicializa el SDK de OTel si se provee un endpoint OTLP.
 * Debe llamarse UNA VEZ al inicio de la aplicación, antes de crear spans.
 *
 * @param otlpEndpoint - URL del collector OTLP HTTP. Si es undefined, no hace nada.
 */
export function startTracing(otlpEndpoint: string | undefined): void {
  if (otlpEndpoint === undefined) {
    // Sin endpoint → tracing inerte. El API OTel actúa como noop global.
    return;
  }

  const exporter = new OTLPTraceExporter({ url: otlpEndpoint });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "ledger-wallet",
    }),
    traceExporter: exporter,
  });

  sdk.start();
}

/**
 * Cierra el SDK de OTel gracefully (flush de spans pendientes).
 * Debe llamarse en el shutdown de la aplicación (SIGTERM/SIGINT).
 *
 * Si el SDK no fue inicializado (tracing inerte), no hace nada.
 */
export async function stopTracing(): Promise<void> {
  if (sdk === undefined) return;
  await sdk.shutdown();
  sdk = undefined;
}
