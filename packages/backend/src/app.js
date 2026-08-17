/**
 * Aplicação Express.
 * Centraliza configuração de middlewares e registro de rotas.
 */
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const { env } = require("./config/env");
const { errorHandler } = require("./middlewares/error");
const { notFound } = require("./middlewares/notFound");

// Rotas (módulos)
const authRoutes = require("./modules/auth/auth.routes");
const produtoRoutes = require("./modules/produtos/produto.routes");
const healthRoutes = require("./modules/health/health.routes");

function createApp() {
  const app = express();

  // --- Segurança e parsing ---
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.cors.origins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("CORS não permitido para esta origem: " + origin));
        }
      },
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );
  app.options("*", cors());
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  if (env.isDev) {
    app.use(morgan("dev"));
  }

  // --- Rate limiting global ---
  app.use(
    rateLimit({
      windowMs: env.rateLimit.windowMs,
      max: env.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // --- Rotas ---
  app.use("/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/produtos-cadastro", produtoRoutes);

  // --- 404 e erros (devem ser os últimos) ---
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
