/**
 * Adapter Prometheus para el puerto MetricsRecorder (Fase 5).
 *
 * Usa un Registry PROPIO de prom-client (no el default global) para garantizar
 * aislamiento entre instancias y facilitar el testing unitario sin contaminación
 * de estado global.
 *
 * Métricas expuestas (ver ADR 0013 para justificación de nombres y buckets):
 *   - ledger_transfers_total          Counter  label: outcome
 *   - ledger_accounts_created_total   Counter  (sin labels)
 *   - ledger_transfer_duration_seconds Histogram buckets estándar
 *
 * IMPORTANTE: este archivo es el ÚNICO lugar del proyecto que importa prom-client.
 * Las capas de domain/ y application/ dependen solo del puerto MetricsRecorder.
 */

import { Registry, Counter, Histogram } from "prom-client";
import type { MetricsRecorder, TransferOutcome } from "../../application/ports/metrics-recorder.js";

export class PrometheusMetrics implements MetricsRecorder {
  /** Registry privado: aislado del default global, testeable de forma independiente. */
  private readonly _registry: Registry;

  private readonly transfersTotal: Counter<"outcome">;
  private readonly accountsCreatedTotal: Counter;
  private readonly transferDurationSeconds: Histogram;

  constructor() {
    this._registry = new Registry();

    // Counter: total de transferencias por resultado
    this.transfersTotal = new Counter({
      name: "ledger_transfers_total",
      help: "Total de intentos de transferencia, etiquetados por resultado",
      labelNames: ["outcome"] as const,
      registers: [this._registry],
    });

    // Counter: total de cuentas creadas exitosamente
    this.accountsCreatedTotal = new Counter({
      name: "ledger_accounts_created_total",
      help: "Total de cuentas creadas exitosamente",
      registers: [this._registry],
    });

    // Histogram: duración de Transfer.execute() en segundos (éxito o error)
    // Buckets cubren el rango típico de operaciones de DB: desde 5ms hasta 5s
    this.transferDurationSeconds = new Histogram({
      name: "ledger_transfer_duration_seconds",
      help: "Duración de Transfer.execute() en segundos (incluye casos de error)",
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this._registry],
    });
  }

  /** Getter del registry para que la ruta /metrics pueda leer las métricas. */
  get registry(): Registry {
    return this._registry;
  }

  recordTransfer(outcome: TransferOutcome): void {
    this.transfersTotal.inc({ outcome });
  }

  recordAccountCreated(): void {
    this.accountsCreatedTotal.inc();
  }

  observeTransferDuration(seconds: number): void {
    this.transferDurationSeconds.observe(seconds);
  }
}
