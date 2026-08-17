/**
 * Serviço de autenticação.
 * Responsável por login, renovação de token e geração de JWT.
 */
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { prisma } = require("../../config/prisma");
const { env } = require("../../config/env");
const { HttpError } = require("../../utils/http");
const { sanitizeOperador } = require("../../utils/sanitize");

/**
 * Autentica operador por email ou id + senha.
 * Compatível com hashes bcrypt existentes.
 */
async function login({ identificador, senha }) {
  if (!identificador || !senha) {
    throw new HttpError(400, "Identificador e senha são obrigatórios");
  }

  // Busca por email (produção) ou por id (TV/renovação)
  const where = isNaN(parseInt(identificador, 10))
    ? { email: identificador }
    : { id: parseInt(identificador, 10) };

  const operador = await prisma.operador.findFirst({
    where: { ...where, ativo: undefined },
  });

  if (!operador) {
    throw new HttpError(401, "Credenciais inválidas");
  }

  const senhaValida = await bcrypt.compare(senha, operador.senha);
  if (!senhaValida) {
    throw new HttpError(401, "Credenciais inválidas");
  }

  const token = gerarToken(operador);

  return { operador: sanitizeOperador(operador), token };
}

/**
 * Renova o token de um operador autenticado.
 */
async function renovarToken(operadorId) {
  const operador = await prisma.operador.findUnique({ where: { id: operadorId } });

  if (!operador) {
    throw new HttpError(404, "Operador não encontrado");
  }

  const token = gerarToken(operador);
  return { operador: sanitizeOperador(operador), token };
}

function gerarToken(operador) {
  return jwt.sign(
    {
      id: operador.id,
      nome: operador.nome,
      administrador: operador.administrador,
      tipo_operador: operador.tipoOperador,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
}

module.exports = { login, renovarToken, gerarToken };
