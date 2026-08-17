/**
 * Middleware de tratamento de erros global.
 * Deve ser o último middleware registrado no app.
 */
const { env } = require("../config/env");

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const message = err.message || "Erro interno do servidor";

  if (env.isDev) {
    console.error("[ERROR]", err);
  }

  res.status(status).json({
    error: message,
    ...(env.isDev && err.stack ? { stack: err.stack } : {}),
  });
}

/**
 * Wrapper para capturar erros assíncronos em handlers de rota.
 * Permite usar async/await sem try/catch manual.
 *
 * @example router.get("/", asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncHandler };
