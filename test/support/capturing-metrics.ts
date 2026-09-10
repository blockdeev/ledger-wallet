import type { MetricsRecorder, TransferOutcome } from "../../src/application/ports/metrics-recorder.js";

/** Entrada capturada por CapturingMetrics. */
export type CapturedMetric =
  | { kind: "transfer"; outcome: TransferOutcome }
  | { kind: "account_created" }
  | { kind: "transfer_duration"; seconds: number };

/**
 * Doble de test para el puerto MetricsRecorder.
 *
 * Acumula todas las llamadas en un array `calls` para que los tests puedan
 * afirmar sobre las métricas emitidas sin depender de prom-client ni de
 * ningún registry externo.
 *
 * Uso típico:
 *   const metrics = new CapturingMetrics();
 *   const useCase = new CreateAccount(repo, logger, metrics);
 *   await useCase.execute(input);
 *   expect(metrics.accountCreatedCount()).toBe(1);
 */
export class CapturingMetrics implements MetricsRecorder {
  readonly calls: CapturedMetric[] = [];

  recordTransfer(outcome: TransferOutcome): void {
    this.calls.push({ kind: "transfer", outcome });
  }

  recordAccountCreated(): void {
    this.calls.push({ kind: "account_created" });
  }

  observeTransferDuration(seconds: number): void {
    this.calls.push({ kind: "transfer_duration", seconds });
  }

  // ── Helpers de conveniencia ───────────────────────────────────────────────

  /** Filtra todas las llamadas a recordTransfer con el outcome dado. */
  transfersWithOutcome(outcome: TransferOutcome): number {
    return this.calls.filter(
      (c): c is { kind: "transfer"; outcome: TransferOutcome } =>
        c.kind === "transfer" && c.outcome === outcome
    ).length;
  }

  /** Cuenta llamadas a recordAccountCreated. */
  accountCreatedCount(): number {
    return this.calls.filter((c) => c.kind === "account_created").length;
  }

  /** Devuelve todos los valores de duración observados (en segundos). */
  durationObservations(): number[] {
    return this.calls
      .filter((c): c is { kind: "transfer_duration"; seconds: number } => c.kind === "transfer_duration")
      .map((c) => c.seconds);
  }
}
