/**
 * Rotas de autenticação.
 * Prefixo: /api/auth
 */
const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const { autenticarToken } = require("../../middlewares/auth");
const { validarRequisicao } = require("../../middlewares/validate");
const { loginHandler, renovarTokenHandler } = require("./auth.controller");

router.post(
  "/login",
  [
    body("identificador").notEmpty().withMessage("Identificador (email ou id) é obrigatório"),
    body("senha").notEmpty().withMessage("Senha é obrigatória"),
  ],
  validarRequisicao,
  loginHandler
);

router.post("/renovar-token", autenticarToken, renovarTokenHandler);

module.exports = router;
