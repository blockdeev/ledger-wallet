export interface AppConfig {
  port: number;
  databaseUrl: string;
}

export function loadConfig(): AppConfig {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const databaseUrl = process.env.DATABASE_URL ?? "";

  return { port, databaseUrl };
}
