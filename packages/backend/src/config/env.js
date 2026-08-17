/**
 * Configuração central de variáveis de ambiente.
 * Carrega o .env e expõe valores tipados com defaults seguros.
 */
require("dotenv").config();

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: (process.env.NODE_ENV || "development") === "production",
  isDev: (process.env.NODE_ENV || "development") === "development",

  port: parseInt(process.env.PORT || "3001", 10),

  databaseUrl: process.env.DATABASE_URL || "",

  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-me",
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || "http://localhost:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "300", 10),
  },
};

module.exports = { env };
