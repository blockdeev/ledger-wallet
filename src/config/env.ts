/**
 * Lectura y validación fail-fast de la configuración de entorno.
 * Lanza ConfigError en el arranque si alguna variable requerida falta o es inválida.
 * Sin dependencias externas (validación manual).
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Niveles válidos de pino. */
const VALID_LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** Nivel de log pino. Default: "info". Configurable vía LOG_LEVEL. */
  logLevel: LogLevel;
}

/**
 * Lee y valida las variables de entorno.
 * @throws ConfigError si DATABASE_URL falta o está vacía.
 * @throws ConfigError si PORT no es un entero > 0.
 * @throws ConfigError si LOG_LEVEL viene y no es un nivel pino válido.
 */
export function loadConfig(): AppConfig {
  const portRaw = process.env.PORT ?? "3000";
  const port = parseInt(portRaw, 10);

  if (!Number.isInteger(port) || isNaN(port) || port <= 0) {
    throw new ConfigError(
      `Invalid PORT value "${portRaw}": must be a positive integer. Got: ${portRaw}`
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new ConfigError(
      "Missing required environment variable DATABASE_URL. " +
        "Set it to a valid PostgreSQL connection string (e.g. postgresql://user:pass@host:5432/db)."
    );
  }

  const logLevelRaw = process.env.LOG_LEVEL ?? "info";
  if (!(VALID_LOG_LEVELS as readonly string[]).includes(logLevelRaw)) {
    throw new ConfigError(
      `Invalid LOG_LEVEL value "${logLevelRaw}": must be one of ${VALID_LOG_LEVELS.join(", ")}.`
    );
  }
  const logLevel = logLevelRaw as LogLevel;

  return { port, databaseUrl, logLevel };
}
