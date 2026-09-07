# ADR 0007 — Modelo de partida doble: postings con monto firmado que suman cero

**Status:** Accepted  
**Date:** 2024-01-01  
**Deciders:** Equipo de dominio

---

## Context

Un motor contable (ledger) necesita registrar movimientos de dinero de forma que el sistema
sea auditable, reversible y matemáticamente consistente. El modelo contable clásico es la
**partida doble** (double-entry bookkeeping): cada transacción tiene al menos un débito y un
crédito de igual monto. Debemos decidir cómo representar esto en el código.

Las alternativas principales son:

1. **Débito/Crédito explícitos**: cada posting tiene un campo `type: "DEBIT" | "CREDIT"` y
   un monto positivo. La validación de balance compara `sum(debits) == sum(credits)`.
2. **Monto firmado**: cada posting tiene un monto con signo (`bigint`). Positivo significa
   incremento del saldo de esa cuenta; negativo, decremento. La validación de balance es
   `sum(amounts) == 0`.

---

## Decision

Usamos **postings con monto firmado**. Un `Posting` es `{ accountId, amount: Money }` donde
`amount` puede ser positivo o negativo. La invariante de balance es:

```
∑ posting.amount.minor == 0n
```

---

## Consequences

### Equivalencia con débito/crédito clásico

El modelo de monto firmado es **matemáticamente equivalente** al modelo débito/crédito:

```
DEBIT  acc-A  1000  →  Posting { accountId: "acc-A", amount: -1000 }
CREDIT acc-B  1000  →  Posting { accountId: "acc-B", amount: +1000 }
```

La suma de los montos firmados es `-1000 + 1000 = 0`, lo que expresa exactamente la misma
relación que `débito == crédito` del modelo clásico.

La semántica de "incrementa o decrementa el saldo" también es más directa para implementar
`applyTransaction`: simplemente se suma el monto (con su signo) al saldo actual de cada
cuenta, sin necesidad de distinguir tipos.

### Por qué se eligió esta representación

**1. Invariante único y testeable**: la condición `sum == 0` es un único predicado numérico
sobre `bigint`. Es trivial de implementar, de testear, y de verificar en review de código.
El modelo débito/crédito requiere mantener dos sumas separadas y compararlas.

**2. Menos tipos y menos código**: no necesitamos un enum `DEBIT | CREDIT`, no necesitamos
  lógica condicional en `applyTransaction` para decidir si sumar o restar según el tipo.

**3. Generalización natural a N postings**: el modelo firmado soporta transacciones de 3 o
más postings (split payments, fee distributions) sin ningún cambio: simplemente siguen
sumando cero. En el modelo débito/crédito clásico, las transacciones N→M requieren sumar
dos grupos y comparar.

**4. Menos superficie de error**: con monto firmado no existe el error de "aplicar un débito
como crédito" en la cuenta incorrecta; el signo del monto lleva toda la información.

### Trade-off / Alternativa descartada

**Modelo débito/crédito explícito**: más familiar para contadores tradicionales y para
sistemas que generan reportes T-account. En un sistema expuesto directamente a equipos de
contabilidad podría ser preferible. Se descartó porque:

- El dominio es un motor interno; la presentación en formato débito/crédito puede ocurrir en
  la capa de adaptadores sin cambiar el modelo.
- La invariante `sum == 0` es más simple de implementar y de probar.
- Lemon, Stripe y la mayoría de los ledgers modernos usan el modelo de monto firmado.

**Verificación de la regla de frontera del linter** (ADR relevante para la regla de linting):
Para confirmar que la regla `no-restricted-imports` en `eslint.config.js` efectivamente
prohíbe imports de infraestructura desde `src/domain/`, se puede agregar temporalmente
en cualquier archivo de dominio:

```ts
// En src/domain/money.ts — BORRAR después de probar
import fastify from "fastify"; // ← ESLint debe reportar error inmediatamente
```

Al correr `npm run lint`, el error aparece:
```
error  Import from "fastify" is restricted. Domain must not depend on Fastify (HTTP adapter).
  no-restricted-imports
```

Esta prueba se realizó manualmente durante el desarrollo y se revirtió. La regla está
activa en producción.

---

## Invariantes de LedgerTransaction (resumen)

| # | Invariante | Error lanzado |
|---|---|---|
| 1 | Al menos 2 postings | `InsufficientPostingsError` |
| 2 | Todos los postings en la misma currency | `CurrencyMismatchError` |
| 3 | Ningún posting con monto cero | `NonZeroPostingError` |
| 4 | Suma de todos los montos == 0 | `UnbalancedTransactionError` |
