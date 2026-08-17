/**
 * Controller de autenticação.
 * Recebe requisições HTTP e delega para o auth.service.
 */
const { login, renovarToken } = require("./auth.service");
const { ok } = require("../../utils/http");
const { asyncHandler } = require("../../middlewares/error");

const loginHandler = asyncHandler(async (req, res) => {
  const { identificador, senha } = req.body;
  const resultado = await login({ identificador, senha });
  ok(res, resultado);
});

const renovarTokenHandler = asyncHandler(async (req, res) => {
  const resultado = await renovarToken(req.user.id);
  ok(res, resultado);
});

module.exports = { loginHandler, renovarTokenHandler };
