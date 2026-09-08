# ledger-wallet

Motor contable (ledger) de una billetera digital: la pieza de **doble entrada** que hay
debajo de una app tipo Brubank, Lemon o NaranjaX. No es un clon de neobanco — es el núcleo
donde viven la integridad del dinero y las reglas de negocio, construido con foco productivo.

Proyecto de portfolio. Prioridades de ingeniería: arquitectura hexagonal, TDD, tipado
estricto, y un camino claro hacia observabilidad, CI/CD e integración con AWS.

## Estado

El proyecto se construye por fases. Cada fase se documenta con un ADR y se integra vía
Pull Request con el CI en verde.

- [x] **Fase 0 — Walking skeleton.** Compila, testea, linta, bootea y buildea en Docker con CI.
- [x] **Fase 1 — Núcleo de dominio (TDD).** `Money`, `Account`, `Posting`, `LedgerTransaction` y sus invariantes; 100% test-first.
- [x] **Fase 2 — Ports y casos de uso.** Puertos de salida (`AccountRepository`, `TransactionRepository`), casos de uso (`CreateAccount`, `Transfer`, `GetBalance`), adapters in-memory, derivación de saldo desde historial. Tests end-to-end sin DB.
- [ ] **Fase 3 — Persistencia.**
  - [x] **Fase 3a — Adapters Postgres detrás de los puertos.** `PostgresAccountRepository` y `PostgresTransactionRepository` sobre PostgreSQL 16 + Kysely, implementando los mismos puertos de Fase 2. Migraciones versionadas en código; validación fail-fast de `config/env`; contract tests reutilizables que corren tanto sobre in-memory como sobre Postgres (testcontainers). El saldo sigue derivándose del historial; atomicidad e idempotencia en Fase 3b.
  - [x] **Fase 3b — Endpoints HTTP y transferencias seguras bajo concurrencia.** Los tres casos de uso expuestos por HTTP (Fastify). Puerto `UnitOfWork` que envuelve `Transfer` en una transacción de DB con `SELECT ... FOR UPDATE ORDER BY id` para serializar transferencias concurrentes y eliminar el doble-gasto. Saldo derivado dentro de la transacción con lock. Sin idempotencia (Fase 3c).
  - [ ] **Fase 3c — Idempotencia.** Header `Idempotency-Key`, constraint único, retry seguro.
- [ ] **Fase 4 — Observabilidad.** Logging estructurado, tracing, métricas.
- [ ] **Fase 5 — CI/CD y despliegue.**
- [ ] **Fase 6 — Integración AWS** (SQS / SNS / S3).

## Stack

| Capa          | Tecnología                              |
| ------------- | --------------------------------------- |
| Runtime       | Node.js 22 LTS                          |
| Lenguaje      | TypeScript 5 (strict + ESM)             |
| HTTP adapter  | Fastify 5                               |
| Tests         | Vitest 3                                |
| Query builder | Kysely + PostgreSQL 16                  |
| Linting       | ESLint 9 (typescript-eslint) + Prettier |
| Contenedores  | Docker multi-stage + docker-compose     |
| CI            | GitHub Actions                          |

## Arquitectura

Hexagonal (ports & adapters), un bounded context, con la **regla de dependencia** apuntando
siempre hacia el dominio. El dominio es TypeScript puro: no importa Fastify, ni Kysely, ni
`pg`, ni nada de infraestructura.

Esa frontera **se hace cumplir con el linter**, no solo con un diagrama: una regla de ESLint
prohíbe que `src/domain/**` importe adapters, config, la capa de aplicación o librerías de
infraestructura. Si alguien la cruza, el lint —y por lo tanto el CI— falla.

```
src/
  domain/         # Lógica de negocio pura (sin infraestructura)
  application/
    ports/        # Interfaces (contratos) hacia/desde el dominio
  adapters/
    inbound/      # Drivers de entrada (HTTP con Fastify)
    outbound/     # Driven adapters (repositorios, clientes externos)
  config/         # Lectura de configuración / entorno
  shared/
```

Las decisiones de diseño (por qué Fastify, por qué Kysely y no un ORM, por qué `bigint` para
el dinero, por qué hexagonal y no layered) están registradas en [`docs/adr/`](docs/adr).

## Modelo de dominio

- **`Money`** — value object inmutable. Representa montos como enteros en unidades mínimas
  (centavos) con `bigint`, nunca con punto flotante. Aritmética y comparaciones seguras por
  moneda: operar entre monedas distintas lanza `CurrencyMismatchError`.
- **`Account`** — `{ id, currency, type }`. `AccountType` ∈
  `CUSTOMER_WALLET | SYSTEM_CLEARING | EXTERNAL`. Las wallets de cliente no pueden quedar en
  negativo; las de sistema/externas sí.
- **`Posting`** — un movimiento con signo sobre una cuenta (no puede ser cero).
- **`LedgerTransaction`** — conjunto de **≥ 2 postings que suman cero** (partida doble). Al
  construirse valida que esté balanceada, en una sola moneda y sin montos cero; si no, lanza
  el error de dominio correspondiente (`UnbalancedTransactionError`, `CurrencyMismatchError`,
  `NonZeroPostingError`, `InsufficientPostingsError`).
- **`applyTransaction`** — función pura que aplica una transacción a un mapa de saldos,
  **todo-o-nada**, respetando la política de sobregiro (una wallet de cliente que quedaría
  negativa lanza `OverdraftError` y no aplica nada).

Los errores viven en el dominio y hablan su propio idioma (`DomainError` y subclases), no
códigos HTTP.

## Casos de uso

La capa de aplicación (`src/application/`) orquesta el dominio a través de puertos (interfaces)
inyectados por constructor. Los casos de uso son puros respecto de la infraestructura: no
conocen HTTP, DB ni ningún framework.

- **`CreateAccount`** — Registra una nueva cuenta en el repositorio. Recibe `{ id, currency,
  type }`. Lanza `AccountAlreadyExistsError` si el id ya existe.

- **`Transfer`** — Transfiere fondos entre dos cuentas. Recibe `{ id, fromAccountId,
  toAccountId, amount, occurredAt? }`. Valida existencia de ambas cuentas
  (`AccountNotFoundError` si falta alguna), construye una `LedgerTransaction` balanceada,
  verifica que la cuenta origen tenga fondos suficientes (`OverdraftError` si es
  `CUSTOMER_WALLET` y quedaría en negativo), y persiste la transacción solo si todo es válido
  (todo-o-nada). Las cuentas `SYSTEM_CLEARING` y `EXTERNAL` pueden quedar en negativo.

- **`GetBalance`** — Calcula el saldo actual de una cuenta derivando la suma de todos sus
  postings desde el historial de transacciones. Lanza `AccountNotFoundError` si la cuenta no
  existe. Si existe pero no tiene movimientos, retorna `Money.zero(currency)`.

El saldo se **deriva del historial** (no se guarda como columna mutable), lo que garantiza
auditabilidad y consistencia. Ver ADR 0008 para el razonamiento completo y la estrategia de
optimización planeada para Fase 3.

## Requisitos

- Node.js 22 (ver [`.nvmrc`](.nvmrc))
- npm
- Docker (opcional, para levantar el stack completo)

## Cómo correr

```bash
npm ci              # instalar dependencias (exacto, desde el lockfile)
npm run dev         # servidor en modo watch
npm run build       # compilar a dist/
npm start           # correr el build
```

### Calidad

```bash
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint (incluye la regla de frontera del dominio)
npm test                  # Vitest unit (sin Docker; rápido)
npm run test:watch        # TDD
npm run test:coverage     # cobertura de domain y application (umbral 90%)
npm run test:integration  # tests de integración con testcontainers (requiere Docker)
```

### Migraciones

```bash
npm run migrate           # aplica migraciones pendientes contra DATABASE_URL
```

Requiere `DATABASE_URL` en el entorno. Ejemplo:

```bash
docker compose up -d db
DATABASE_URL=postgresql://ledger:ledger@localhost:5432/ledger npm run migrate
```

### Docker

```bash
docker compose up --build   # app + PostgreSQL
```

### Cómo correr en local (Fase 3b)

```bash
# 1. Levantar Postgres
docker compose up -d db

# 2. Aplicar migraciones
DATABASE_URL=postgresql://ledger:ledger@localhost:5432/ledger npm run migrate

# 3. Arrancar la app en modo dev
DATABASE_URL=postgresql://ledger:ledger@localhost:5432/ledger PORT=3000 npm run dev
```

## API HTTP (Fase 3b)

> **`minor` siempre como `string`** en request y response — nunca como `number` — para
> preservar la precisión de `bigint` en valores que superan `Number.MAX_SAFE_INTEGER`.

### `GET /health`

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### `POST /accounts`

Crea una cuenta nueva. Falla con 409 si el `id` ya existe.

```bash
# Crear cuenta del sistema (puede ir negativa)
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"sys","currency":"ARS","type":"SYSTEM_CLEARING"}'
# 201 → {"id":"sys","currency":"ARS","type":"SYSTEM_CLEARING"}

# Crear wallet de cliente (no puede ir negativa)
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"wallet-1","currency":"ARS","type":"CUSTOMER_WALLET"}'
# 201 → {"id":"wallet-1","currency":"ARS","type":"CUSTOMER_WALLET"}

# Cuenta duplicada → 409
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"id":"sys","currency":"ARS","type":"SYSTEM_CLEARING"}'
# 409 → {"error":"conflict","message":"..."}
```

**Tipos de cuenta válidos:** `CUSTOMER_WALLET`, `SYSTEM_CLEARING`, `EXTERNAL`.

### `POST /transfers`

Transfiere fondos entre dos cuentas de forma atómica y segura bajo concurrencia.
El `id` identifica la `LedgerTransaction`; debe ser único.

```bash
# Acreditar 10 000 ARS desde sys hacia wallet-1
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "tx-seed-001",
    "fromAccountId": "sys",
    "toAccountId": "wallet-1",
    "amount": { "minor": "1000000", "currency": "ARS" }
  }'
# 201 → {
#   "id": "tx-seed-001",
#   "occurredAt": "2026-09-08T14:00:00.000Z",
#   "postings": [
#     { "accountId": "sys",      "amount": { "minor": "-1000000", "currency": "ARS" } },
#     { "accountId": "wallet-1", "amount": { "minor": "1000000",  "currency": "ARS" } }
#   ]
# }

# Sobregiro en CUSTOMER_WALLET → 422
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "tx-overdraft",
    "fromAccountId": "wallet-1",
    "toAccountId": "sys",
    "amount": { "minor": "9999999999", "currency": "ARS" }
  }'
# 422 → {"error":"overdraft","message":"..."}

# Cuenta desconocida → 404
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{"id":"tx-x","fromAccountId":"ghost","toAccountId":"wallet-1","amount":{"minor":"100","currency":"ARS"}}'
# 404 → {"error":"not_found","message":"..."}
```

### `GET /accounts/:id/balance`

Devuelve el saldo actual derivado del historial de transacciones.

```bash
curl http://localhost:3000/accounts/wallet-1/balance
# 200 → {"accountId":"wallet-1","balance":{"minor":"1000000","currency":"ARS"}}

# Cuenta inexistente → 404
curl http://localhost:3000/accounts/ghost/balance
# 404 → {"error":"not_found","message":"..."}
```

### Mapeo de errores HTTP

| Condición                          | Status | `error`      |
|------------------------------------|--------|--------------|
| Body inválido / tipo desconocido   | 400    | `bad_request`|
| Cuenta ya existe                   | 409    | `conflict`   |
| Cuenta no encontrada               | 404    | `not_found`  |
| Sobregiro en `CUSTOMER_WALLET`     | 422    | `overdraft`  |
| Error interno                      | 500    | —            |

## Tests

Desarrollado por TDD estricto (red → green → refactor, Conventional Commits).

- **Dominio** (`src/domain/`): ~97% líneas, 100% funciones.
- **Aplicación** (`src/application/`): 100% líneas, 100% funciones.
- **Adapters in-memory**: cubiertos por tests unitarios propios + contract tests.
- **Adapters Postgres**: validados por tests de integración con testcontainers (requieren Docker).

La frontera hexagonal tiene verificación doble: el lint falla si `src/domain/**` o
`src/application/**` importan infraestructura o adapters. Los tests de aplicación corren
end-to-end con adapters in-memory, sin base de datos.

### Contract tests

`test/adapters/contract/` define el comportamiento esperado de cada puerto
(`AccountRepository`, `TransactionRepository`). El mismo contrato corre contra el adapter
in-memory (en `npm test`, sin Docker) y contra el adapter Postgres (en `npm run
test:integration`, con testcontainers). Esto demuestra que Postgres es un drop-in del
puerto: la abstracción hexagonal funciona.

## Decisiones de arquitectura (ADRs)

Ver [`docs/adr/`](docs/adr):

- `0001` — Runtime y tipado
- `0002` — Framework HTTP (Fastify)
- `0003` — Runner de tests (Vitest)
- `0004` — Acceso a datos (Kysely + PostgreSQL)
- `0005` — Arquitectura (hexagonal pragmática)
- `0006` — Representación monetaria (`bigint`)
- `0007` — Modelo de partida doble
- `0008` — Capa de aplicación (puertos, DIP, derivación de saldo)
- `0009` — Persistencia (Postgres, Kysely, migraciones en código, testcontainers, contract test)
- `0010` — Concurrencia y atomicidad (UnitOfWork port, `FOR UPDATE ORDER BY id`, saldo derivado con lock)

## Licencia

MIT — ver [`LICENSE`](LICENSE).
