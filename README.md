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
- [ ] **Fase 2 — Ports y casos de uso.** Repositorios (interfaces), `Transfer` / `GetBalance` / `CreateAccount`, adapter in-memory.
- [ ] **Fase 3 — Persistencia.** PostgreSQL + Kysely, migraciones.
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
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint (incluye la regla de frontera del dominio)
npm test              # Vitest (una corrida)
npm run test:watch    # TDD
npm run test:coverage # cobertura del dominio
```

### Docker

```bash
docker compose up --build   # app + PostgreSQL
```

Endpoint disponible hoy: `GET /health` → `{ "status": "ok" }`. Los endpoints de negocio
llegan en fases posteriores.

## Tests

Desarrollado por TDD. El núcleo de dominio se cubre al ~97% de líneas (100% en funciones),
con tests unitarios por cada invariante. La frontera hexagonal tiene su propia verificación:
el lint falla si el dominio importa infraestructura.

## Decisiones de arquitectura (ADRs)

Ver [`docs/adr/`](docs/adr):

- `0001` — Runtime y tipado
- `0002` — Framework HTTP (Fastify)
- `0003` — Runner de tests (Vitest)
- `0004` — Acceso a datos (Kysely + PostgreSQL)
- `0005` — Arquitectura (hexagonal pragmática)
- `0006` — Representación monetaria (`bigint`)
- `0007` — Modelo de partida doble

## Licencia

MIT — ver [`LICENSE`](LICENSE).
