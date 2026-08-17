/**
 * Controller de Produtos.
 * Recebe requisições HTTP e delega para o produto.service.
 */
const service = require("./produto.service");
const { ok, created } = require("../../utils/http");
const { asyncHandler } = require("../../middlewares/error");

const listar = asyncHandler(async (req, res) => {
  const { limit, offset, search } = req.query;
  const resultado = await service.listar({ limit, offset, search });
  ok(res, resultado);
});

const contarTotal = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const resultado = await service.contarTotal({ search });
  ok(res, resultado);
});

const buscarPorId = asyncHandler(async (req, res) => {
  const resultado = await service.buscarPorId(req.params.id);
  ok(res, resultado);
});

const criar = asyncHandler(async (req, res) => {
  const resultado = await service.criar(req.body);
  created(res, resultado);
});

const atualizar = asyncHandler(async (req, res) => {
  const resultado = await service.atualizar(req.params.id, req.body);
  ok(res, resultado);
});

const excluir = asyncHandler(async (req, res) => {
  const resultado = await service.excluir(req.params.id);
  ok(res, resultado);
});

const validarReferencia = asyncHandler(async (req, res) => {
  const { referencia, excluir_id } = req.query;
  const resultado = await service.validarReferencia(referencia, excluir_id);
  ok(res, resultado);
});

const validarEan = asyncHandler(async (req, res) => {
  const { ean13, excluir_id } = req.query;
  const resultado = await service.validarEan(ean13, excluir_id);
  ok(res, resultado);
});

module.exports = {
  listar,
  contarTotal,
  buscarPorId,
  criar,
  atualizar,
  excluir,
  validarReferencia,
  validarEan,
};
