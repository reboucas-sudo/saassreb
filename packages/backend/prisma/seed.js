/**
 * Seed do banco de dados.
 * Cria dados iniciais para desenvolvimento.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed...\n");

  // --- Operador admin ---
  const senhaHash = await bcrypt.hash("admin123", 10);
  const admin = await prisma.operador.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      nome: "Administrador",
      email: "admin@saassreb.local",
      senha: senhaHash,
      administrador: true,
      tipoOperador: "Gestao",
      cargo: "Administrador do Sistema",
    },
  });
  console.log("✅ Operador admin criado:", admin.email);
  console.log("   Senha: admin123\n");

  // --- Unidades ---
  const unPca = await prisma.unidade.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, codigo: "PCA", descricao: "Peça", tipo: "ambos" },
  });
  const unKg = await prisma.unidade.upsert({
    where: { id: 2 },
    update: {},
    create: { id: 2, codigo: "KG", descricao: "Quilograma", tipo: "ambos" },
  });
  console.log("✅ Unidades criadas:", unPca.codigo, unKg.codigo);

  // --- Produto exemplo ---
  const produto = await prisma.produto.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      referenciaProduto: "PROD-EXEMPLO-001",
      dsProduto: "Produto Exemplo Injetado",
      ean13: "7891234567890",
      tpProduto: "PRODUTO_ACABADO",
      tempoPadraoInjecaoSegundos: 30,
      pecasPorCiclo: 4,
      metaHorariaInjecao: 400,
      vlPesobrutoProduto: 0.125,
      estoqueMinimo: 100,
      pontoPedido: 200,
      loteCompra: 500,
      idUnidadeCompra: 2,
      idUnidadeConsumo: 1,
      fatorConversaoCompraConsumo: 8,
      leadTimeCompraDias: 7,
    },
  });
  console.log("✅ Produto exemplo criado:", produto.referenciaProduto);

  console.log("\n🌱 Seed concluído com sucesso!");
}

main()
  .catch((e) => {
    console.error("❌ Erro no seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
