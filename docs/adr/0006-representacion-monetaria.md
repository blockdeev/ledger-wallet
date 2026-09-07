# ADR 0006 — Representación monetaria: bigint en unidades mínimas

**Status:** Accepted  
**Date:** 2024-01-01  
**Deciders:** Equipo de dominio

---

## Context

El sistema necesita representar montos de dinero con precisión exacta. Cualquier error de
redondeo en operaciones financieras es inaceptable: puede producir descuadres contables,
pérdidas o ganancias espurias, y problemas regulatorios. Debemos elegir el tipo de dato
correcto para almacenar importes.

Las alternativas consideradas fueron:

1. `number` (IEEE 754 double-precision float)
2. `string` (representación textual, ej. "123.45")
3. Una librería de decimales como `decimal.js` o `big.js`
4. `bigint` en unidades mínimas (centavos)

---

## Decision

Usamos **`bigint` en unidades mínimas** (centavos). Un peso argentino equivale a 100 unidades;
un centavo, a 1 unidad. El valor `ARS 1234.56` se almacena como `123456n`.

La clase `Money` encapsula este `bigint` junto con el código de moneda ISO 4217, y expone
operaciones aritméticas que devuelven nuevas instancias (inmutabilidad).

---

## Consequences

### Por qué NO `number` (float)

`number` en JavaScript es IEEE 754 de 64 bits. Las operaciones con decimales producen errores
de representación acumulables:

```js
0.1 + 0.2 === 0.3  // false → 0.30000000000000004
```

En un ledger esto es fatal: sumas de muchos postings pueden no dar exactamente cero, y las
validaciones de balance fallarían o peor, pasarían con un error silencioso.

Además, `number` puede representar exactamente enteros sólo hasta `Number.MAX_SAFE_INTEGER`
(2⁵³ − 1 ≈ 9 × 10¹⁵). Para montos en pesos argentinos con inflación alta, eso limita a
~90 billones de pesos en centavos, suficiente hoy pero sin margen futuro.

### Por qué NO `string`

Requiere parsear en cada operación, es más lento, y obliga a mantener invariantes de formato
a mano. Además, no hay soporte nativo para aritmética.

### Por qué NO una librería de decimales

Agrega una dependencia de runtime y complejidad sin ganancia real: si las operaciones son
siempre en centavos (enteros), `bigint` es equivalente sin overhead.

### Por qué `bigint`

- **Sin overflow práctico**: `bigint` crece dinámicamente; `9007199254740991n * 1000n` es
  exacto sin pérdida.
- **Aritmética exacta**: suma, resta y multiplicación por enteros son exactas por definición.
  No hay punto flotante.
- **Soporte nativo en Node.js 22**: no requiere polyfills ni librerías.
- **Rendimiento adecuado**: las operaciones de ledger son aritméticas simples sobre enteros;
  `bigint` es suficientemente rápido para este caso de uso.

### Trade-off: serialización en los bordes

El único costo de `bigint` es en la frontera con el exterior:

- **JSON**: `JSON.stringify` no serializa `bigint` por defecto → se convierte a `string` o
  `number` en los adaptadores HTTP/DB (fuera del dominio).
- **PostgreSQL con Kysely**: se mapea como `bigint` de Postgres o como `numeric`; el adaptador
  se encarga de la conversión. El dominio permanece puro.
- **Presentación al usuario**: se formatea en el adaptador de presentación (ej. `"$1.234,56"`).

Esta conversión ocurre siempre en la capa de adaptadores, **nunca en el dominio**, manteniendo
la arquitectura hexagonal íntegra.

---

## Alternativa descartada: `Decimal.js` / `big.js`

Se evaluó usar una librería de decimales de alta precisión. Se descartó porque:

1. No se necesita precisión decimal arbitraria: los montos mínimos son enteros (centavos).
2. Agrega dependencia de runtime que el dominio no debería tener.
3. `bigint` cubre exactamente el caso de uso con soporte nativo.
