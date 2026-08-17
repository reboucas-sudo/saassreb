import { useState, useEffect, useCallback } from "react";
import * as produtosApi from "../api/produtos";

export default function Produtos() {
  const [produtos, setProdutos] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  // Estado do formulário
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formErros, setFormErros] = useState({});
  const [saving, setSaving] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro("");
    try {
      const [lista, tot] = await Promise.all([
        produtosApi.listarProdutos({ limit, offset: page * limit, search }),
        produtosApi.contarProdutos(search),
      ]);
      setProdutos(lista.produtos);
      setTotal(tot.total);
    } catch (err) {
      setErro("Erro ao carregar produtos");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(0);
    carregar();
  }

  function novoProduto() {
    setForm(emptyForm());
    setEditId(null);
    setFormErros({});
    setShowForm(true);
  }

  async function editarProduto(id) {
    try {
      const data = await produtosApi.buscarProduto(id);
      const p = data.produto;
      setForm({
        referencia_produto: p.referenciaProduto || "",
        ds_produto: p.dsProduto || "",
        ean13: p.ean13 || "",
        tp_produto: p.tpProduto || "",
        tempo_padrao_injecao_segundos: p.tempoPadraoInjecaoSegundos ?? "",
        tempo_padrao_montagem_segundos: p.tempoPadraoMontagemSegundos ?? "",
        tempo_padrao_embalagem_segundos: p.tempoPadraoEmbalagemSegundos ?? "",
        pecas_por_ciclo: p.pecasPorCiclo ?? "",
        meta_horaria_injecao: p.metaHorariaInjecao ?? "",
        meta_horaria_montagem: p.metaHorariaMontagem ?? "",
        meta_horaria_embalagem: p.metaHorariaEmbalagem ?? "",
        vl_pesobruto_produto: p.vlPesobrutoProduto ?? "",
        estoque_minimo: p.estoqueMinimo ?? "",
        ponto_pedido: p.pontoPedido ?? "",
        lote_compra: p.loteCompra ?? "",
        lead_time_compra_dias: p.leadTimeCompraDias ?? "",
      });
      setEditId(id);
      setFormErros({});
      setShowForm(true);
    } catch (err) {
      setErro("Erro ao carregar produto para edição");
    }
  }

  async function handleSalvar(e) {
    e.preventDefault();
    setFormErros({});
    setSaving(true);
    try {
      if (editId) {
        await produtosApi.atualizarProduto(editId, form);
      } else {
        await produtosApi.criarProduto(form);
      }
      setShowForm(false);
      await carregar();
    } catch (err) {
      const errors = err.response?.data?.errors;
      if (Array.isArray(errors)) {
        const map = {};
        errors.forEach((e) => {
          const campo = e.param.split("_")[0];
          map[campo] = e.msg;
        });
        setFormErros(map);
      } else {
        setFormErros({ geral: err.response?.data?.error || "Erro ao salvar produto" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleExcluir(id) {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;
    try {
      await produtosApi.excluirProduto(id);
      await carregar();
    } catch (err) {
      setErro("Erro ao excluir produto");
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ color: "#1e293b" }}>Produtos</h2>
        <button onClick={novoProduto} style={btnPrimary}>
          + Novo Produto
        </button>
      </div>

      {erro && <div style={erroStyle}>{erro}</div>}

      <form onSubmit={handleSearch} style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por referência ou descrição..."
          style={{ flex: 1, padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
        />
        <button type="submit" style={btnSecondary}>
          Buscar
        </button>
      </form>

      {loading ? (
        <p>Carregando...</p>
      ) : (
        <>
          <div style={{ overflowX: "auto", background: "#fff", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <Th>Referência</Th>
                  <Th>Descrição</Th>
                  <Th>Tipo</Th>
                  <Th>EAN13</Th>
                  <Th>Pçs/Ciclo</Th>
                  <Th>Meta Inj.</Th>
                  <Th>Peso Bruto</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {produtos.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: "2rem", color: "#94a3b8" }}>
                      Nenhum produto encontrado
                    </td>
                  </tr>
                ) : (
                  produtos.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <Td>{p.referenciaProduto}</Td>
                      <Td>{p.dsProduto}</Td>
                      <Td>{p.tpProduto || "-"}</Td>
                      <Td>{p.ean13 || "-"}</Td>
                      <Td>{p.pecasPorCiclo ?? "-"}</Td>
                      <Td>{p.metaHorariaInjecao ?? "-"}</Td>
                      <Td>{p.vlPesobrutoProduto ? `${p.vlPesobrutoProduto} kg` : "-"}</Td>
                      <Td>
                        <button onClick={() => editarProduto(p.id)} style={btnSmall}>
                          Editar
                        </button>
                        <button
                          onClick={() => handleExcluir(p.id)}
                          style={{ ...btnSmall, background: "#dc2626", marginLeft: "0.25rem" }}
                        >
                          Excluir
                        </button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#64748b" }}>
              {total} produto(s) • Página {page + 1} de {totalPages || 1}
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={btnSecondary}>
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={btnSecondary}
              >
                Próximo
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal Formulário */}
      {showForm && (
        <div style={modalOverlay} onClick={() => setShowForm(false)}>
          <div style={modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "1rem", color: "#1e293b" }}>
              {editId ? "Editar Produto" : "Novo Produto"}
            </h3>
            {formErros.geral && <div style={erroStyle}>{formErros.geral}</div>}
            <form onSubmit={handleSalvar} style={{ display: "grid", gap: "0.75rem" }}>
              <div style={grid2}>
                <Campo label="Referência *" erro={formErros.referencia}>
                  <input
                    type="text"
                    value={form.referencia_produto}
                    onChange={(e) => setForm({ ...form, referencia_produto: e.target.value })}
                    required
                    style={inputForm}
                  />
                </Campo>
                <Campo label="EAN13">
                  <input
                    type="text"
                    maxLength={13}
                    value={form.ean13}
                    onChange={(e) => setForm({ ...form, ean13: e.target.value })}
                    style={inputForm}
                  />
                </Campo>
              </div>

              <Campo label="Descrição *" erro={formErros.ds}>
                <input
                  type="text"
                  value={form.ds_produto}
                  onChange={(e) => setForm({ ...form, ds_produto: e.target.value })}
                  required
                  style={inputForm}
                />
              </Campo>

              <Campo label="Tipo de Produto">
                <select
                  value={form.tp_produto}
                  onChange={(e) => setForm({ ...form, tp_produto: e.target.value })}
                  style={inputForm}
                >
                  <option value="">Selecione...</option>
                  <option value="PRODUTO_ACABADO">Produto Acabado</option>
                  <option value="MATERIA_PRIMA">Matéria-Prima</option>
                  <option value="EMBALAGEM">Embalagem</option>
                  <option value="INSUMO">Insumo</option>
                </select>
              </Campo>

              <fieldset style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem" }}>
                <legend style={{ fontWeight: "bold", color: "#475569" }}>Tempos Padrão (segundos)</legend>
                <div style={grid3}>
                  <Campo label="Tempo Injeção">
                    <input type="number" step="0.01" value={form.tempo_padrao_injecao_segundos} onChange={(e) => setForm({ ...form, tempo_padrao_injecao_segundos: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Tempo Montagem">
                    <input type="number" step="0.01" value={form.tempo_padrao_montagem_segundos} onChange={(e) => setForm({ ...form, tempo_padrao_montagem_segundos: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Tempo Embalagem">
                    <input type="number" step="0.01" value={form.tempo_padrao_embalagem_segundos} onChange={(e) => setForm({ ...form, tempo_padrao_embalagem_segundos: e.target.value })} style={inputForm} />
                  </Campo>
                </div>
              </fieldset>

              <fieldset style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem" }}>
                <legend style={{ fontWeight: "bold", color: "#475569" }}>Metas e Produção</legend>
                <div style={grid3}>
                  <Campo label="Peças/Ciclo">
                    <input type="number" step="0.01" value={form.pecas_por_ciclo} onChange={(e) => setForm({ ...form, pecas_por_ciclo: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Meta Horária Injeção">
                    <input type="number" step="0.01" value={form.meta_horaria_injecao} onChange={(e) => setForm({ ...form, meta_horaria_injecao: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Meta Horária Montagem">
                    <input type="number" step="0.01" value={form.meta_horaria_montagem} onChange={(e) => setForm({ ...form, meta_horaria_montagem: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Meta Horária Embalagem">
                    <input type="number" step="0.01" value={form.meta_horaria_embalagem} onChange={(e) => setForm({ ...form, meta_horaria_embalagem: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Peso Bruto (kg)">
                    <input type="number" step="0.000001" value={form.vl_pesobruto_produto} onChange={(e) => setForm({ ...form, vl_pesobruto_produto: e.target.value })} style={inputForm} />
                  </Campo>
                </div>
              </fieldset>

              <fieldset style={{ border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem" }}>
                <legend style={{ fontWeight: "bold", color: "#475569" }}>Compras / Estoque</legend>
                <div style={grid3}>
                  <Campo label="Estoque Mínimo">
                    <input type="number" step="0.000001" value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Ponto Pedido">
                    <input type="number" step="0.000001" value={form.ponto_pedido} onChange={(e) => setForm({ ...form, ponto_pedido: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Lote Compra">
                    <input type="number" step="0.000001" value={form.lote_compra} onChange={(e) => setForm({ ...form, lote_compra: e.target.value })} style={inputForm} />
                  </Campo>
                  <Campo label="Lead Time (dias)">
                    <input type="number" value={form.lead_time_compra_dias} onChange={(e) => setForm({ ...form, lead_time_compra_dias: e.target.value })} style={inputForm} />
                  </Campo>
                </div>
              </fieldset>

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button type="button" onClick={() => setShowForm(false)} style={btnSecondary}>
                  Cancelar
                </button>
                <button type="submit" disabled={saving} style={btnPrimary}>
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

function emptyForm() {
  return {
    referencia_produto: "",
    ds_produto: "",
    ean13: "",
    tp_produto: "",
    tempo_padrao_injecao_segundos: "",
    tempo_padrao_montagem_segundos: "",
    tempo_padrao_embalagem_segundos: "",
    pecas_por_ciclo: "",
    meta_horaria_injecao: "",
    meta_horaria_montagem: "",
    meta_horaria_embalagem: "",
    vl_pesobruto_produto: "",
    estoque_minimo: "",
    ponto_pedido: "",
    lote_compra: "",
    lead_time_compra_dias: "",
  };
}

function Campo({ label, erro, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span style={{ fontSize: "0.85rem", color: "#475569" }}>{label}</span>
      {children}
      {erro && <span style={{ color: "#dc2626", fontSize: "0.75rem" }}>{erro}</span>}
    </label>
  );
}

const Th = { padding: "0.6rem", textAlign: "left", fontSize: "0.85rem", color: "#475569", borderBottom: "2px solid #e2e8f0" };
const Td = { padding: "0.6rem", fontSize: "0.9rem", color: "#1e293b" };
const btnPrimary = { padding: "0.5rem 1rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem" };
const btnSecondary = { padding: "0.5rem 1rem", background: "#e2e8f0", color: "#1e293b", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.9rem" };
const btnSmall = { padding: "0.3rem 0.6rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" };
const erroStyle = { background: "#fee2e2", color: "#991b1b", padding: "0.75rem", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.9rem" };
const inputForm = { padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.9rem" };
const grid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" };
const grid3 = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" };
const modalOverlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" };
const modalContent = { background: "#fff", borderRadius: "12px", padding: "1.5rem", width: "100%", maxWidth: "700px", maxHeight: "90vh", overflowY: "auto" };
