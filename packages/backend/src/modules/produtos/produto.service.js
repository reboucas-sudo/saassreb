/**
 * Serviço de Produtos (cadastro).
 * Substitui as rotas duplicadas /api/produtos-cadastro/* do server.js antigo.
 *
 * Operações:
 *  - listar (com busca e paginação)
 *  - contar total (com busca)
 *  - buscarPorId
 *  - criar
 *  - atualizar
 *  - excluir (soft delete via ativo=false, mantendo integridade)
 *  - validarReferencia (unique)
 *  - validarEan (unique)
 */
const { prisma } = require("../../config/prisma");
const { HttpError } = require("../../utils/http");

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

/**
 * Lista produtos com busca opcional e paginação.
 * Inclui unidades de compra e consumo.
 */
async function listar({ limit = DEFAULT_LIMIT, offset = DEFAULT_OFFSET, search } = {}) {
  const where = search
    ? {
        OR: [
          { referenciaProduto: { contains: search } },
          { dsProduto: { contains: search } },
        ],
      }
    : {};

  const [produtos, total] = await Promise.all([
    prisma.produto.findMany({
      where,
      orderBy: { referenciaProduto: "asc" },
      take: parseInt(limit, 10),
      skip: parseInt(offset, 10),
      include: {
        unidadeCompra: { select: { id: true, codigo: true, descricao: true } },
        unidadeConsumo: { select: { id: true, codigo: true, descricao: true } },
      },
    }),
    prisma.produto.count({ where }),
  ]);

  return { produtos, total };
}

/**
 * Conta o total de produtos com filtro de busca opcional.
 */
async function contarTotal({ search } = {}) {
  const where = search
    ? {
        OR: [
          { referenciaProduto: { contains: search } },
          { dsProduto: { contains: search } },
        ],
      }
    : {};

  const total = await prisma.produto.count({ where });
  return { total };
}

/**
 * Busca um produto por ID, incluindo unidades.
 */
async function buscarPorId(id) {
  const produto = await prisma.produto.findUnique({
    where: { id: parseInt(id, 10) },
    include: {
      unidadeCompra: { select: { id: true, codigo: true, descricao: true } },
      unidadeConsumo: { select: { id: true, codigo: true, descricao: true } },
    },
  });

  if (!produto) {
    throw new HttpError(404, "Produto não encontrado");
  }

  return { produto };
}

/**
 * Cria um novo produto.
 * Verifica unicidade de referência antes de inserir.
 */
async function criar(dados) {
  const referenciaExistente = await prisma.produto.findFirst({
    where: { referenciaProduto: dados.referenciaProduto },
    select: { id: true },
  });

  if (referenciaExistente) {
    throw new HttpError(400, "Já existe um produto com esta referência");
  }

  if (dados.ean13) {
    const eanExistente = await prisma.produto.findFirst({
      where: { ean13: dados.ean13 },
      select: { id: true },
    });
    if (eanExistente) {
      throw new HttpError(400, "Já existe um produto com este EAN13");
    }
  }

  const produto = await prisma.produto.create({
    data: normalizarDados(dados),
    include: {
      unidadeCompra: { select: { id: true, codigo: true, descricao: true } },
      unidadeConsumo: { select: { id: true, codigo: true, descricao: true } },
    },
  });

  return { produto };
}

/**
 * Atualiza um produto existente.
 */
async function atualizar(id, dados) {
  const produtoId = parseInt(id, 10);

  const produtoExistente = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: { id: true },
  });

  if (!produtoExistente) {
    throw new HttpError(404, "Produto não encontrado");
  }

  if (dados.referenciaProduto) {
    const conflito = await prisma.produto.findFirst({
      where: {
        referenciaProduto: dados.referenciaProduto,
        NOT: { id: produtoId },
      },
      select: { id: true },
    });
    if (conflito) {
      throw new HttpError(400, "Já existe um produto com esta referência");
    }
  }

  const produto = await prisma.produto.update({
    where: { id: produtoId },
    data: normalizarDados(dados),
    include: {
      unidadeCompra: { select: { id: true, codigo: true, descricao: true } },
      unidadeConsumo: { select: { id: true, codigo: true, descricao: true } },
    },
  });

  return { produto };
}

/**
 * Exclui um produto (soft delete).
 * Mantém integridade referencial marcando ativo=false.
 */
async function excluir(id) {
  const produtoId = parseInt(id, 10);

  const produtoExistente = await prisma.produto.findUnique({
    where: { id: produtoId },
    select: { id: true },
  });

  if (!produtoExistente) {
    throw new HttpError(404, "Produto não encontrado");
  }

  await prisma.produto.update({
    where: { id: produtoId },
    data: { ativo: false },
  });

  return { message: "Produto excluído com sucesso" };
}

/**
 * Valida se uma referência está disponível (única).
 * @param {string} referencia - referência a validar
 * @param {number|null} excluirId - id a ignorar (para edição)
 */
async function validarReferencia(referencia, excluirId = null) {
  if (!referencia) return { valido: true };

  const where = { referenciaProduto: referencia };
  if (excluirId) {
    where.NOT = { id: parseInt(excluirId, 10) };
  }

  const existente = await prisma.produto.findFirst({
    where,
    select: { id: true },
  });

  return {
    valido: !existente,
    ...(existente ? { mensagem: "Referência já está em uso" } : {}),
  };
}

/**
 * Valida se um EAN13 está disponível (único).
 */
async function validarEan(ean13, excluirId = null) {
  if (!ean13) return { valido: true };

  const where = { ean13: ean13 };
  if (excluirId) {
    where.NOT = { id: parseInt(excluirId, 10) };
  }

  const existente = await prisma.produto.findFirst({
    where,
    select: { id: true },
  });

  return {
    valido: !existente,
    ...(existente ? { mensagem: "EAN13 já está em uso" } : {}),
  };
}

/**
 * Normaliza os dados de entrada antes de enviar ao Prisma.
 * Converte strings vazias para null e aplica defaults.
 */
function normalizarDados(dados) {
  const camposNumericos = [
    "tempoPadraoMontagemSegundos",
    "tempoPadraoEmbalagemSegundos",
    "tempoPadraoInjecaoSegundos",
    "pecasPorCiclo",
    "metaHorariaMontagem",
    "metaHorariaEmbalagem",
    "metaHorariaInjecao",
    "vlPesobrutoProduto",
    "estoqueMinimo",
    "pontoPedido",
    "loteCompra",
  ];

  const resultado = {};

  if (dados.referenciaProduto !== undefined) resultado.referenciaProduto = dados.referenciaProduto;
  if (dados.dsProduto !== undefined) resultado.dsProduto = dados.dsProduto;
  if (dados.ean13 !== undefined) resultado.ean13 = dados.ean13 || null;
  if (dados.idUnidadeCompra !== undefined) {
    resultado.idUnidadeCompra = dados.idUnidadeCompra ? parseInt(dados.idUnidadeCompra, 10) : null;
  }
  if (dados.idUnidadeConsumo !== undefined) {
    resultado.idUnidadeConsumo = dados.idUnidadeConsumo ? parseInt(dados.idUnidadeConsumo, 10) : null;
  }
  if (dados.fatorConversaoCompraConsumo !== undefined) {
    resultado.fatorConversaoCompraConsumo = dados.fatorConversaoCompraConsumo || 1;
  }
  if (dados.tpProduto !== undefined) resultado.tpProduto = dados.tpProduto;
  if (dados.leadTimeCompraDias !== undefined) {
    resultado.leadTimeCompraDias = parseInt(dados.leadTimeCompraDias, 10) || 0;
  }
  if (dados.grupoprodutoid !== undefined) resultado.grupoprodutoid = dados.grupoprodutoid;
  if (dados.subgrupoprodutoid !== undefined) resultado.subgrupoprodutoid = dados.subgrupoprodutoid;

  // Campos numéricos (string vazia -> null)
  for (const campo of camposNumericos) {
    if (dados[campo] !== undefined) {
      resultado[campo] = dados[campo] === "" || dados[campo] === null ? null : Number(dados[campo]);
    }
  }

  return resultado;
}

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
