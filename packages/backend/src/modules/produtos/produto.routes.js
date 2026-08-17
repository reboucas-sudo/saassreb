/**
 * Rotas de Produtos (cadastro).
 * Prefixo: /api/produtos-cadastro
 *
 * Elimina a duplicação do server.js antigo, onde cada rota
 * existia duas vezes (com e sem /api) para contornar proxy Apache.
 * Agora há uma única definição e o proxy é resolvido na infra.
 */
const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const { autenticarToken } = require("../../middlewares/auth");
const { validarRequisicao } = require("../../middlewares/validate");
const controller = require("./produto.controller");

// Validações compartilhadas entre criar e atualizar
const validacoesProduto = [
  body("referencia_produto").notEmpty().withMessage("Referência é obrigatória"),
  body("ds_produto").notEmpty().withMessage("Descrição é obrigatória"),
  body("ean13").optional({ nullable: true }).isLength({ max: 13 }).withMessage("EAN13 deve ter no máximo 13 caracteres"),
];

// --- Rotas de validação (devem vir ANTES de /:id para não conflitar) ---

router.get("/validar-referencia", controller.validarReferencia);
router.get("/validar-ean", controller.validarEan);
router.get("/total", controller.contarTotal);

// --- CRUD ---

router.get("/", autenticarToken, controller.listar);
router.get("/:id", autenticarToken, controller.buscarPorId);
router.post("/", autenticarToken, validacoesProduto, validarRequisicao, controller.criar);
router.put("/:id", autenticarToken, validacoesProduto, validarRequisicao, controller.atualizar);
router.delete("/:id", autenticarToken, controller.excluir);

module.exports = router;
