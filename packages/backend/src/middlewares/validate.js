/**
 * Helpers para validação com express-validator.
 * Centraliza a verificação de erros e respostas padronizadas.
 */
const { validationResult } = require("express-validator");

/**
 * Middleware que executa após os validators do express-validator.
 * Se houver erros de validação, responde 400 com a lista.
 */
function validarRequisicao(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

module.exports = { validarRequisicao };
