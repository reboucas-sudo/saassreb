import api from "./client";

/**
 * API de Produtos (cadastro).
 * Espelha as rotas /api/produtos-cadastro do backend.
 */

export async function listarProdutos({ limit = 50, offset = 0, search = "" } = {}) {
  const { data } = await api.get("/produtos-cadastro", {
    params: { limit, offset, search },
  });
  return data;
}

export async function contarProdutos(search = "") {
  const { data } = await api.get("/produtos-cadastro/total", { params: { search } });
  return data;
}

export async function buscarProduto(id) {
  const { data } = await api.get(`/produtos-cadastro/${id}`);
  return data;
}

export async function criarProduto(produto) {
  const { data } = await api.post("/produtos-cadastro", produto);
  return data;
}

export async function atualizarProduto(id, produto) {
  const { data } = await api.put(`/produtos-cadastro/${id}`, produto);
  return data;
}

export async function excluirProduto(id) {
  const { data } = await api.delete(`/produtos-cadastro/${id}`);
  return data;
}

export async function validarReferencia(referencia, excluirId = null) {
  const { data } = await api.get("/produtos-cadastro/validar-referencia", {
    params: { referencia, excluir_id: excluirId },
  });
  return data;
}

export async function validarEan(ean13, excluirId = null) {
  const { data } = await api.get("/produtos-cadastro/validar-ean", {
    params: { ean13, excluir_id: excluirId },
  });
  return data;
}
