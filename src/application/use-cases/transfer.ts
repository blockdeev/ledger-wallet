import { Money } from "../../domain/money.js";
import { LedgerTransaction, createTransaction } from "../../domain/ledger-transaction.js";
import { createPosting } from "../../domain/posting.js";
import { applyTransaction } from "../../domain/balances.js";
import { UnitOfWork, TransactionalContext } from "../ports/unit-of-work.js";
import {
  AccountNotFoundError,
  DuplicateIdempotencyKeyError,
  IdempotencyConflictError,
} from "../errors.js";
import { deriveBalance } from "../balance-derivation.js";

export interface TransferInput {
  /** Id de la LedgerTransaction a crear. */
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: Money;
  occurredAt?: Date;
  /**
   * Clave de idempotencia opcional (Idempotency-Key HTTP header).
   * Si está ausente, el comportamiento es idéntico a Fase 3b.
   */
  idempotencyKey?: string;
}

export interface TransferResult {
  transaction: LedgerTransaction;
  /**
   * `true` si la respuesta es un replay de una transferencia ya ejecutada.
   * `false` si es una alta nueva.
   */
  replayed: boolean;
}

/**
 * Genera un fingerprint determinístico del input de transferencia.
 *
 * Función pura: dado el mismo input siempre produce el mismo string.
 * Permite detectar dos requests con la misma Idempotency-Key pero payload
 * distinto y lanzar IdempotencyConflictError.
 */
export function computeFingerprint(input: TransferInput): string {
  return `${input.id}|${input.fromAccountId}|${input.toAccountId}|${input.amount.minor.toString()}|${input.amount.currency}`;
}

/**
 * Caso de uso: transferir fondos entre dos cuentas de forma atómica y segura
 * bajo concurrencia, con soporte opcional de idempotencia vía Idempotency-Key.
 *
 * Comportamiento según presencia de `idempotencyKey`:
 *
 *   Sin clave → flujo idéntico a Fase 3b (sin semántica de idempotencia,
 *   sin registro de clave). Los tests de 3b siguen válidos sin cambios.
 *
 *   Con clave (RESERVE-FIRST, ver ADR 0011):
 *     1. Buscar registro existente:
 *        - Existe + fingerprint igual  → replay (devuelve tx original, sin mover dinero).
 *        - Existe + fingerprint distinto → IdempotencyConflictError (409).
 *     2. No existe → RESERVAR la clave PRIMERO, luego ejecutar la transferencia.
 *        Si la transferencia falla (p. ej. OverdraftError), el rollback del UoW
 *        deshace también la reserva → la clave NO queda "quemada".
 *
 *   Carrera concurrente (misma clave, dos requests simultáneos):
 *     Ambos ven findByKey=undefined y ambos intentan save().
 *     La constraint UNIQUE deja pasar solo uno:
 *       - Ganador: INSERT ok → ejecuta transfer → { replayed:false }.
 *       - Perdedor: su INSERT bloquea hasta que el ganador commitea;
 *         recibe DuplicateIdempotencyKeyError → su tx de DB hace ROLLBACK
 *         → el use case CAPTURA y REINTENTA UNA VEZ en nueva transacción:
 *         findByKey ahora encuentra el registro → replay → { replayed:true }.
 *
 * @throws AccountNotFoundError si alguna cuenta no existe.
 * @throws OverdraftError si la cuenta origen es CUSTOMER_WALLET y no tiene fondos.
 * @throws IdempotencyConflictError si la misma clave se usa con payload distinto.
 */
export class Transfer {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: TransferInput): Promise<TransferResult> {
    // Sin clave de idempotencia → comportamiento exacto de 3b
    if (input.idempotencyKey === undefined) {
      return this.uow.transaction(async (ctx) => {
        const transaction = await this.executeTransfer(ctx, input);
        return { transaction, replayed: false };
      });
    }

    // Con clave de idempotencia → reserve-first
    return this.executeIdempotent(input, input.idempotencyKey, false);
  }

  /**
   * Flujo idempotente con reserve-first.
   *
   * @param isRetry - `true` cuando se llama desde el catch de DuplicateIdempotencyKeyError.
   *   En el reintento, save() no se llama de nuevo (evita reingresar al catch).
   */
  private async executeIdempotent(
    input: TransferInput,
    key: string,
    isRetry: boolean
  ): Promise<TransferResult> {
    try {
      return await this.uow.transaction(async (ctx) => {
        // 1. Buscar registro existente
        const existing = await ctx.idempotency.findByKey(key);

        if (existing !== undefined) {
          const fingerprint = computeFingerprint(input);
          if (existing.fingerprint !== fingerprint) {
            throw new IdempotencyConflictError(key);
          }
          // Replay: devolver la transacción original sin mover dinero
          const tx = await ctx.transactions.findById(existing.transactionId);
          if (tx === undefined) {
            // No debería ocurrir si la escritura fue atómica; es un error interno
            throw new Error(
              `Idempotency record found for key '${key}' but transaction '${existing.transactionId}' not found.`
            );
          }
          return { transaction: tx, replayed: true };
        }

        // 2. No existe → RESERVAR PRIMERO (el INSERT puede lanzar DuplicateIdempotencyKeyError)
        if (!isRetry) {
          const fingerprint = computeFingerprint(input);
          await ctx.idempotency.save({
            key,
            transactionId: input.id,
            fingerprint,
          });
        }

        // 3. Ejecutar la transferencia después de reservar
        const transaction = await this.executeTransfer(ctx, input);
        return { transaction, replayed: false };
      });
    } catch (err) {
      if (err instanceof DuplicateIdempotencyKeyError && !isRetry) {
        // La constraint única serializó la carrera concurrente.
        // La transacción de DB de esta request ya hizo ROLLBACK.
        // Reintentar UNA VEZ en una nueva transacción → findByKey encontrará
        // el registro escrito por el ganador → replay.
        return this.executeIdempotent(input, key, true);
      }
      throw err;
    }
  }

  /**
   * Ejecuta el flujo de transferencia puro (sin semántica de idempotencia).
   * Idéntico al flujo de Fase 3b: lock → findById×2 → deriveBalance →
   * applyTransaction → append.
   *
   * Extraído como helper privado para ser invocado tanto desde el flujo sin
   * clave como desde el flujo idempotente (después de la reserva).
   */
  private async executeTransfer(
    ctx: TransactionalContext,
    input: TransferInput
  ): Promise<LedgerTransaction> {
    // a. Lock pesimista en orden canónico (evita deadlocks A→B vs B→A concurrentes)
    await ctx.lockAccounts([input.fromAccountId, input.toAccountId]);

    // b. Buscar ambas cuentas
    const [fromAccount, toAccount] = await Promise.all([
      ctx.accounts.findById(input.fromAccountId),
      ctx.accounts.findById(input.toAccountId),
    ]);

    if (fromAccount === undefined) {
      throw new AccountNotFoundError(input.fromAccountId);
    }
    if (toAccount === undefined) {
      throw new AccountNotFoundError(input.toAccountId);
    }

    // c. Derivar saldos actuales de las cuentas involucradas
    const [fromTxs, toTxs] = await Promise.all([
      ctx.transactions.listByAccount(input.fromAccountId),
      ctx.transactions.listByAccount(input.toAccountId),
    ]);

    const fromBalance = deriveBalance(input.fromAccountId, fromAccount, fromTxs);
    const toBalance = deriveBalance(input.toAccountId, toAccount, toTxs);

    // Sembrar el mapa con saldos reales (crítico: evita falsos OverdraftError)
    const seedBalances = new Map([
      [input.fromAccountId, fromBalance],
      [input.toAccountId, toBalance],
    ]);

    // d. Construir la transacción balanceada
    const tx = createTransaction({
      id: input.id,
      postings: [
        createPosting(input.fromAccountId, input.amount.negate()),
        createPosting(input.toAccountId, input.amount),
      ],
      occurredAt: input.occurredAt ?? new Date(),
    });

    // Lookup de las cuentas ya buscadas (ambas conocidas)
    const accountLookup = (id: string) => {
      if (id === input.fromAccountId) return fromAccount;
      if (id === input.toAccountId) return toAccount;
      return undefined;
    };

    // Puede lanzar OverdraftError; si lo hace, el throw aborta la tx de DB → rollback
    applyTransaction(seedBalances, tx, accountLookup);

    // e. Persistir y devolver
    await ctx.transactions.append(tx);
    return tx;
  }
}
