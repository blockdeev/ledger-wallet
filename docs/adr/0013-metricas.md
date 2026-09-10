# ADR 0013 — Observabilidad: métricas de negocio vía puerto MetricsRecorder + Prometheus

**Estado**: Aceptado
**Fecha**: 2025-06 (Fase 5)
**Relación**: complementa ADR 0012 (logging) y anticipa ADR futuro de tracing (Fase 6)

---

## Contexto

Tras el logging estructurado de la Fase 4, la siguiente capa de observabilidad requerida es la de
**métricas de negocio**: contadores y duraciones que permiten a un scraper Prometheus (o Grafana)
responder preguntas como "¿cuántas transferencias exitosas hubo en la última hora?" o
"¿cuál es el p99 de latencia del use case Transfer?".

El mismo principio que aplicamos para el logging aplica aquí: la lógica de negocio no debe conocer
la biblioteca concreta de telemetría, para no contaminar el dominio con detalles de infraestructura
y facilitar el testing unitario sin instanciar registros externos.

---

## Decisión

### 1. Puerto semántico `MetricsRecorder` en `src/application/ports/`

Se define la interfaz con métodos que hablan de **conceptos de negocio**, no de contadores ni
histogramas:

```typescript
type TransferOutcome = "created" | "replayed" | "conflict" | "overdraft" | "not_found" | "error";

interface MetricsRecorder {
  recordTransfer(outcome: TransferOutcome): void;
  recordAccountCreated(): void;
  observeTransferDuration(seconds: number): void;
}
```

Las capas `domain/` y `application/` dependen **solo** de este puerto. `prom-client` nunca se
importa fuera de `src/adapters/observability/`.

### 2. Adapter `PrometheusMetrics` en `src/adapters/observability/`

Implementa el puerto usando `prom-client`. Decisiones concretas:

| Métrica | Tipo | Labels | Cuándo |
|---|---|---|---|
| `ledger_transfers_total` | Counter | `outcome` | Por cada llamada a `Transfer.execute()` |
| `ledger_accounts_created_total` | Counter | — | Por cada cuenta creada con éxito |
| `ledger_transfer_duration_seconds` | Histogram | — | Por cada llamada a `Transfer.execute()` (éxito o error) |

**Registry propio** (no el default global de `prom-client`): garantiza aislamiento entre instancias
(ej. tests paralelos) y evita colisiones con métricas de otras librerías que usen el registro global.
El registry se expone como getter `registry` para que la ruta `/metrics` pueda leerlo.

**Buckets del histograma**: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]` segundos.
Cubren el rango esperado para operaciones de DB en LAN (5ms–5s). Se ajustarán con datos reales en
producción.

### 3. Inyección por constructor en los tres casos de uso

`Transfer`, `CreateAccount` y `GetBalance` reciben `metrics: MetricsRecorder` por constructor,
idéntico al patrón del `logger`. `GetBalance` lo declara pero no lo usa (lecturas de balance no se
instrumentan, siguiendo el mismo criterio que con el logger; evita ruido y violación de
`noUnusedLocals` con prefijo `_metrics?` opcional).

### 4. Instrumentación de `Transfer`

- `recordTransfer(outcome)` se llama **siempre**: éxito (`"created"`, `"replayed"`), error de
  negocio (`"conflict"`, `"overdraft"`, `"not_found"`), o error inesperado (`"error"`).
- **Corrección Fase 6**: en la implementación inicial, errores inesperados (bugs, caídas de DB)
  se registraban como `"created"`, inflando el contador de éxitos. Se corrigió a `"error"` para
  no contaminar las métricas de negocio. El label `outcome` del adapter Prometheus es abierto
  (string), por lo que el adapter no requirió cambios.
- `observeTransferDuration(seconds)` se registra en un bloque `finally` con `performance.now()`
  para capturar la duración incluso cuando hay error.
- La medición de duración usa `performance.now()` (pragmático; no se introduce un port `Clock` en
  esta fase). **Mejora futura**: Clock port para inyectar tiempo en tests y evitar dependencia
  implícita en el entorno de ejecución.

### 5. Endpoint `GET /metrics`

Ruta Fastify registrada en `buildApp` cuando `deps.metricsRegistry` está presente (opcional, para
no forzar Prometheus en tests que no lo necesitan). Responde con `await registry.metrics()` y el
`Content-Type` propio de Prometheus (`text/plain; version=0.0.4`).

**Sin autenticación**: el endpoint es de scraping interno; no hay auth en la app aún. En un
despliegue real se protegería a nivel de red (sidecar, firewall, allowlist de IPs).

### 6. Doble de test `CapturingMetrics`

Acumula todas las llamadas en un array tipado (`CapturedMetric[]`) con helpers de conveniencia
(`transfersWithOutcome`, `accountCreatedCount`, `durationObservations`). Mismo patrón que
`CapturingLogger`.

---

## Relación con ADR 0012 (logging)

El patrón puerto-adapter aplicado aquí es idéntico al del logging:
- Puerto semántico en `application/ports/` → no conoce la impl concreta.
- Adapter concreto en `adapters/observability/` → única dependencia de la librería.
- Doble de test en `test/support/` → sin dependencias de infra en tests unitarios.

Métricas y logging son **complementarios**: el logging da contexto detallado por evento, las
métricas dan agregados cuantificables en el tiempo.

---

## Relación con tracing (Fase 6)

OpenTelemetry (tracing distribuido) está **diferido a la Fase 6**. El patrón de inyección por
puerto facilitará añadir un `TracingRecorder` con el mismo esquema sin tocar el dominio ni los
casos de uso existentes.

---

## Consecuencias

**Positivo**:
- Fronteras arquitectónicas intactas: `domain/` y `application/` sin referencias a `prom-client`.
- Testabilidad: `CapturingMetrics` permite afirmar outcomes y duraciones sin Prometheus.
- Registry propio: sin colisiones entre tests o instancias.
- `/metrics` listo para scraping por Prometheus o Grafana.

**Negativo / tradeoffs**:
- `performance.now()` incrustado en `Transfer.execute()`: no inyectable sin Clock port. Anotado
  como mejora futura.
- `GetBalance` recibe `_metrics` sin usarlo: ruido en la firma del constructor, necesario para
  consistencia de la API app-scoped. Justificado en el brief.
- `prom-client` añade ~97 paquetes al árbol de dependencias (acepto; es el cliente estándar de
  Node para Prometheus).
