/**
 * Middleware de autenticação via JWT.
 * Substitui o `autenticarToken` do server.js antigo (linha 632).
 *
 * Espera o header: Authorization: Bearer <token>
 */
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

function autenticarToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Acesso negado: Token não fornecido" });
  }

  jwt.verify(token, env.jwt.secret, (err, payload) => {
    if (err) {
      return res.status(403).json({ message: "Token inválido ou expirado" });
    }
    req.user = payload;
    next();
  });
}

module.exports = { autenticarToken };
