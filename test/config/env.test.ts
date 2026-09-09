import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, ConfigError } from "../../src/config/env.js";

describe("loadConfig", () => {
  // Save and restore env vars around each test
  let savedPort: string | undefined;
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    savedPort = process.env.PORT;
    savedDatabaseUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = savedPort;
    }
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
  });

  it("returns valid config when both vars are set", () => {
    process.env.PORT = "4000";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const config = loadConfig();
    expect(config.port).toBe(4000);
    expect(config.databaseUrl).toBe("postgresql://user:pass@localhost:5432/db");
  });

  it("defaults PORT to 3000 when not set", () => {
    delete process.env.PORT;
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const config = loadConfig();
    expect(config.port).toBe(3000);
  });

  it("throws ConfigError when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    process.env.PORT = "3000";

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/DATABASE_URL/);
  });

  it("throws ConfigError when DATABASE_URL is empty string", () => {
    process.env.DATABASE_URL = "";
    process.env.PORT = "3000";

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/DATABASE_URL/);
  });

  it("throws ConfigError when PORT is not a valid integer", () => {
    process.env.PORT = "not-a-number";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it("throws ConfigError when PORT is zero", () => {
    process.env.PORT = "0";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it("throws ConfigError when PORT is negative", () => {
    process.env.PORT = "-1";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it("ConfigError is an instance of Error", () => {
    delete process.env.DATABASE_URL;
    process.env.PORT = "3000";

    try {
      loadConfig();
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(ConfigError);
    }
  });

  // ── logLevel (Fase 4) ─────────────────────────────────────────────────────

  it("logLevel defaults to 'info' when LOG_LEVEL is not set", () => {
    delete process.env.LOG_LEVEL;
    process.env.PORT = "3000";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    const config = loadConfig();
    expect(config.logLevel).toBe("info");
  });

  it("logLevel accepts valid pino levels", () => {
    process.env.PORT = "3000";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";

    for (const level of ["fatal", "error", "warn", "info", "debug", "trace", "silent"]) {
      process.env.LOG_LEVEL = level;
      const config = loadConfig();
      expect(config.logLevel).toBe(level);
    }
  });

  it("throws ConfigError when LOG_LEVEL is invalid", () => {
    process.env.PORT = "3000";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    process.env.LOG_LEVEL = "verbose";

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/LOG_LEVEL/);

    delete process.env.LOG_LEVEL;
  });
});
