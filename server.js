require("dotenv").config({ path: "./server.env" });
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const bodyParser = require("body-parser");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const dotenv = require("dotenv");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const axios = require("axios");
const { extractTextFromFile } = require("./fileProcessor");
const rateLimit = require("express-rate-limit");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const bwipjs = require("bwip-js");
const printServiceUrl = process.env.PRINT_SERVICE_URL || "http://localhost:3002/api";
const http = require("http");
const WebSocket = require("ws");
const { Server: SocketIOServer } = require("socket.io");
const maquinasMonitoradas = new Map();
const Prometheus = require('prom-client');

function organizarEmEtapas(itens) {
  const etapas = [];

  // Parâmetros
  const parametros = itens.filter((i) => i.tipo === "PARAMETRO");
  if (parametros.length > 0) {
    etapas.push({
      titulo: "Parâmetros do Processo",
      itens: parametros.map((p) => ({
        id: p.id,
        descricao: p.descricao,
        tipo: p.tipo.toLowerCase(),
        instrucao: p.instrucao,
        valorIdeal: p.valorIdeal,
        unidade: p.unidade,
        defeitos: p.defeitos || [],
        naoConformidades: p.nao_conformidades || [],
        codigoDefeito: p.codigoDefeito,
      })),
    });
  }

  // Controle de Qualidade
  const controles = itens.filter((i) => i.tipo === "OPCAO");
  if (controles.length > 0) {
    etapas.push({
      titulo: "Controle de Qualidade",
      itens: controles.map((c) => ({
        id: c.id,
        descricao: c.descricao,
        tipo: c.tipo.toLowerCase(),
        instrucao: c.instrucao,
        opcoes: ["Conforme", "Não Conforme"],
        defeitos: c.defeitos || [],
        naoConformidades: c.nao_conformidades || [],
      })),
    });
  }

  return etapas;
}

function organizarEmEtapas(itens) {
  const etapas = [];

  // Parâmetros
  const parametros = itens.filter((i) => i.tipo === "PARAMETRO");
  if (parametros.length > 0) {
    etapas.push({
      titulo: "Parâmetros do Processo",
      itens: parametros,
    });
  }

  // 2. Etapa de Controle de Qualidade
  const controles = itens.filter((i) => i.tipo === "OPCAO");
  if (controles.length > 0) {
    etapas.push({
      titulo: "Controle de Qualidade",
      itens: controles,
    });
  }

  // Não conformidades
  const ncs = itens.filter(
    (i) => i.tipo === "DEFEITO" || i.tipo === "NAO_CONFORMIDADE",
  );
  if (ncs.length > 0) {
    etapas.push({
      titulo: "Registro de Não Conformidades",
      itens: ncs,
    });
  }

  return etapas;
}

dotenv.config();
const app = express();
const planejamentoRouter = express.Router();
const enderecamentoRouter = express.Router();
const port = process.env.PORT || 3001;
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: [
      "http://localhost:4200",       // localhost dev
      "http://127.0.0.1:4200",       // 127.0.0.1 dev
      "http://192.168.10.134",
      "http://192.168.10.246",
      "http://localhost",      // rede interna (HTTP)
      "http://192.168.10.246:3000",
      "http://192.168.10.246:3001",
      "http://192.168.10.246:8080",  // Tomcat
    ],
    methods: ["GET", "POST"],
    credentials: true,
    transports: ["polling", "websocket"],
  },
  path: "/socket.io/",
  transports: ["polling", "websocket"],
  allowEIO3: true, // Compatibilidade
});

console.log("✅ Socket.IO configurado");

// Conexões Socket.io
const conexoes = new Map();

io.on("connection", (socket) => {
  console.log("🎉 NOVA CONEXÃO SOCKET.IO ESTABELECIDA!");
  console.log("🔗 Socket ID:", socket.id);
  console.log("📍 Headers:", socket.handshake.headers);

  // Mensagem de boas-vindas
  socket.emit("conexao_estabelecida", {
    mensagem: "Conectado ao chat com Socket.IO!",
    socketId: socket.id,
    timestamp: new Date().toISOString(),
  });

  socket.on("inscrever_quantidade_pecas", (maquinaIds) => {
    console.log("📊 Inscrição para quantidade_pecas:", maquinaIds);

    if (Array.isArray(maquinaIds)) {
      maquinaIds.forEach((maquinaId) => {
        monitorarQuantidadePecas(maquinaId, socket);

        // Confirmar
        socket.emit("inscricao_quantidade_confirmada", {
          maquina_id: maquinaId,
          mensagem: `Monitorando peças da máquina ${maquinaId}`,
        });
      });
    }
  });

  socket.on("cancelar_monitoramento_pecas", (maquinaId) => {
    console.log(`⏹️ Parando monitoramento de peças da máquina ${maquinaId}`);
    limparMonitoramentoPecas(socket, maquinaId);
  });

  socket.on("disconnect", (reason) => {
    console.log(`🔌 Socket desconectado: ${socket.id}`);

    // Limpar monitoramentos de peças
    if (socket.monitoramentosPecas) {
      Object.values(socket.monitoramentosPecas).forEach(clearInterval);
    }

    // Autenticação
    socket.on("autenticar", async (dados) => {
      console.log("🔑 Autenticação:", dados);
      conexoes.set(dados.operador_id, socket);

      socket.emit("autenticacao_confirmada", {
        operador_id: dados.operador_id,
        mensagem: `Autenticado como ${dados.operador_nome || "Operador " + dados.operador_id}`,
      });

      // Carregar notificações iniciais
      await carregarNotificacoesIniciais(dados.operador_id, socket);
    });

    // Mensagens
    socket.on("enviar_mensagem", async (dados) => {
      console.log("💬 Nova mensagem:", dados);
      await processarNovaMensagem(dados);
    });

    // Ping/pong
    socket.on("ping", () => {
      socket.emit("pong", { timestamp: new Date().toISOString() });
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 Socket desconectado: ${socket.id} - Razão: ${reason}`);
      for (let [operadorId, socketConn] of conexoes.entries()) {
        if (socketConn === socket) {
          conexoes.delete(operadorId);
          console.log(`👋 Operador ${operadorId} desconectado`);
          break;
        }
      }
    });

    socket.on("error", (error) => {
      console.error("💥 Erro Socket.IO:", error);
    });
  });
});

// Habilita as métricas padrão (CPU, memória, event loop, etc.)
Prometheus.collectDefaultMetrics({ 
    prefix: 'nodeapp_'  // prefixo para identificar suas métricas
});

const httpRequestCounter = new Prometheus.Counter({
    name: 'nodeapp_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
});

// Middleware para contar requisições (se você usa Express)
app.use((req, res, next) => {
    res.on('finish', () => {
        httpRequestCounter.labels(req.method, req.route?.path || req.path, res.statusCode).inc();
    });
    next();
});

// Endpoint que o Prometheus vai consultar para coletar as métricas
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', Prometheus.register.contentType);
    const metrics = await Prometheus.register.metrics();
    res.end(metrics);
});

async function carregarNotificacoesIniciais(operadorId, socket) {
  try {
    const notificacoes = await pool.query(
      `SELECT COUNT(*) as total FROM chat_notificacoes WHERE operador_id = $1 AND lida = false`,
      [operadorId],
    );

    socket.emit("notificacoes_iniciais", {
      mensagens_nao_lidas: parseInt(notificacoes.rows[0].total),
    });
  } catch (error) {
    console.error("Erro ao carregar notificações:", error);
  }
}

// Mantenha a função processarNovaMensagem, mas adapte para Socket.io
async function processarNovaMensagem(dados) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("📨 Processando nova mensagem:", dados);

    // Inserir mensagem (mesmo código anterior)
    const result = await client.query(
      `INSERT INTO chat_mensagens 
       (sala_id, operador_id, mensagem, tipo, arquivo_nome, arquivo_url) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [
        dados.sala_id,
        dados.operador_id,
        dados.mensagem,
        dados.tipo || "texto",
        dados.arquivo_nome,
        dados.arquivo_url,
      ],
    );

    // Buscar participantes e notificar via Socket.io
    const participantes = await client.query(
      `SELECT operador_id FROM chat_participantes 
       WHERE sala_id = $1 AND operador_id != $2 AND ativo = true`,
      [dados.sala_id, dados.operador_id],
    );

    for (let participante of participantes.rows) {
      await client.query(
        `INSERT INTO chat_notificacoes 
         (operador_id, sala_id, mensagem_id) 
         VALUES ($1, $2, $3)`,
        [participante.operador_id, dados.sala_id, result.rows[0].id],
      );

      // Notificar via Socket.io
      const socketParticipante = conexoes.get(participante.operador_id);
      if (socketParticipante) {
        socketParticipante.emit("nova_mensagem", result.rows[0]);
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao processar mensagem:", error);
  } finally {
    client.release();
  }
}

// =============================================
// FUNÇÕES AUXILIARES PARA CÁLCULO DE DATAS ÚTEIS
// =============================================

// Cache de feriados (atualizado anualmente)
let feriadosCache = {};
let dataFeriadosCache = null;

// Buscar feriados nacionais da API Brasil
async function buscarFeriados(ano) {
  try {
    // Verificar se já temos no cache e se é do mesmo ano
    if (dataFeriadosCache && new Date(dataFeriadosCache).getFullYear() === ano) {
      return feriadosCache;
    }

    console.log(`📅 Buscando feriados de ${ano} da API Brasil...`);
    const response = await axios.get(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    
    // Converter array de feriados em objeto para lookup rápido
    feriadosCache = {};
    response.data.forEach(feriado => {
      feriadosCache[feriado.date] = feriado.name;
    });
    
    dataFeriadosCache = new Date();
    console.log(`✅ ${Object.keys(feriadosCache).length} feriados carregados para ${ano}`);
    
    return feriadosCache;
  } catch (error) {
    console.error(`❌ Erro ao buscar feriados:`, error.message);
    // Retornar feriados conhecidos como fallback
    return {
      '2026-01-01': 'Ano Novo',
      '2026-03-17': 'Carnaval',
      '2026-03-18': 'Carnaval',
      '2026-04-10': 'Sexta-feira Santa',
      '2026-04-21': 'Tiradentes',
      '2026-05-01': 'Dia do Trabalho',
      '2026-09-07': 'Independência',
      '2026-10-12': 'Nossa Senhora Aparecida',
      '2026-11-02': 'Finados',
      '2026-11-15': 'Proclamação da República',
      '2026-11-20': 'Consciência Negra',
      '2026-12-25': 'Natal'
    };
  }
}

// Verificar se data é fim de semana
function ehFimDeSemana(data) {
  const dia = data.getDay();
  return dia === 0 || dia === 6; // 0 = domingo, 6 = sábado
}

// Verificar se data é feriado
function ehFeriado(data, feriados) {
  const dataStr = data.toISOString().split('T')[0]; // YYYY-MM-DD
  return feriados[dataStr] !== undefined;
}

// Calcular 3 dias úteis antes de uma data (respeitando feriados e finais de semana)
async function calcularDataInicioSeparacao(dataDespacho) {
  try {
    const data = new Date(dataDespacho);
    const ano = data.getFullYear();
    
    // Buscar feriados do ano
    const feriados = await buscarFeriados(ano);
    
    // Se o ano mudar durante o cálculo, buscar feriados do próximo ano também
    let feriadosProximo = feriados;
    if (data.getMonth() === 0 && data.getDate() < 5) {
      // Se a data é no início de janeiro, buscar feriados do ano anterior também
      feriadosProximo = await buscarFeriados(ano - 1);
      Object.assign(feriadosProximo, feriados);
    } else if (data.getMonth() === 11 && data.getDate() > 25) {
      // Se a data é no final de dezembro, buscar feriados do próximo ano também
      feriadosProximo = await buscarFeriados(ano + 1);
      Object.assign(feriados, feriadosProximo);
    }
    
    let diasUteisContados = 0;
    let dataAtual = new Date(data);
    
    // Voltar um dia por vez até contar 3 dias úteis
    while (diasUteisContados < 3) {
      dataAtual.setDate(dataAtual.getDate() - 1);
      
      if (!ehFimDeSemana(dataAtual) && !ehFeriado(dataAtual, feriados)) {
        diasUteisContados++;
      }
    }
    
    console.log(`📅 Data despacho: ${dataDespacho} → Data início separação: ${dataAtual.toISOString().split('T')[0]}`);
    return dataAtual;
  } catch (error) {
    console.error('❌ Erro ao calcular data de separação:', error);
    // Fallback: retornar 5 dias antes (aproximado)
    const data = new Date(dataDespacho);
    data.setDate(data.getDate() - 5);
    return data;
  }
}

// Tipos de planejamento permitidos
const TIPOS_PLANEJAMENTO = {
  PRODUCAO: "producao",
  MANUTENCAO: "manutencao",
  TROCA_MOLDE: "troca_molde",
};

// Status permitidos
const STATUS_PLANEJAMENTO = {
  PENDENTE: "pendente",
  PLANEJADO: "planejado",
  EM_ANDAMENTO: "em_andamento",
  CONCLUIDO: "concluido",
  PARADO: "parado",
  CANCELADO: "cancelado",
};

// Iniciar o servidor

// Configuração do PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "192.168.10.253",
  database: process.env.DB_NAME || "Monitoramento_Producao",
  password: process.env.DB_PASSWORD || "Analista#2024",
  port: process.env.DB_PORT || 5432,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  maxUses: 7500,
});

const poolSeven = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "192.168.10.252",
  database: process.env.DB_NAME || "AWORKSDB",
  password: process.env.DB_PASSWORD || "aw2000",
  port: process.env.DB_PORT || 5432,
});

const MLService = require("./ml-service");
const mlService = new MLService(pool);
const registrarLog = async (
  tipo_evento,
  mensagem,
  dados = {},
  id_apontamento = null,
  id_operador = null,
  nivel = "INFO",
) => {
  try {
    await pool.query(
      "INSERT INTO logs_apontamento (id_apontamento, id_operador, tipo_evento, mensagem, dados, nivel) VALUES ($1, $2, $3, $4, $5, $6)",
      [id_apontamento, id_operador, tipo_evento, mensagem, dados, nivel],
    );
    console.log(`[${nivel}] ${tipo_evento}: ${mensagem}`, dados);
  } catch (err) {
    console.error("Erro ao registrar log:", err);
  }
};

const registrarErro = async (
  mensagem,
  erro,
  id_apontamento = null,
  id_operador = null,
) => {
  const dadosErro = {
    stack: erro.stack,
    mensagem: erro.message,
    ...erro,
  };
  await registrarLog("ERRO", mensagem, dadosErro, id_apontamento, id_operador);
};

const ensureEstoqueMovimentacoesTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
        id BIGSERIAL PRIMARY KEY,
        tipo_movimentacao VARCHAR(20) NOT NULL,
        id_produto INTEGER NOT NULL,
        id_posicao_origem INTEGER,
        id_posicao_destino INTEGER,
        quantidade NUMERIC(18,3) NOT NULL,
        id_operador INTEGER,
        modulo_origem VARCHAR(80) NOT NULL DEFAULT 'SISTEMA',
        referencia_movimento VARCHAR(80),
        id_referencia BIGINT,
        observacao TEXT,
        data_movimentacao TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_est_mov_data ON estoque_movimentacoes (data_movimentacao DESC)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_est_mov_produto ON estoque_movimentacoes (id_produto)",
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS idx_est_mov_operador ON estoque_movimentacoes (id_operador)",
    );
  } catch (err) {
    console.error("❌ Erro ao garantir tabela estoque_movimentacoes:", err.message);
  }
};

const registrarMovimentacaoEstoque = async (client, movimentacao) => {
  const {
    tipo_movimentacao,
    id_produto,
    id_posicao_origem = null,
    id_posicao_destino = null,
    quantidade,
    id_operador = null,
    modulo_origem = "SISTEMA",
    referencia_movimento = null,
    id_referencia = null,
    observacao = null,
  } = movimentacao;

  if (!tipo_movimentacao || !id_produto || quantidade == null) {
    throw new Error("Campos obrigatórios ausentes para registrar movimentação de estoque");
  }

  const quantidadeNormalizada = Number(quantidade);
  if (!Number.isFinite(quantidadeNormalizada) || quantidadeNormalizada <= 0) {
    return;
  }

  await client.query(
    `INSERT INTO estoque_movimentacoes (
      tipo_movimentacao,
      id_produto,
      id_posicao_origem,
      id_posicao_destino,
      quantidade,
      id_operador,
      modulo_origem,
      referencia_movimento,
      id_referencia,
      observacao,
      data_movimentacao
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [
      tipo_movimentacao,
      id_produto,
      id_posicao_origem,
      id_posicao_destino,
      quantidadeNormalizada,
      id_operador,
      modulo_origem,
      referencia_movimento,
      id_referencia,
      observacao,
    ],
  );
};

const definirContextoAuditoriaEstoque = async (
  client,
  {
    id_operador = null,
    origem_modulo = "SISTEMA",
    origem_tipo = "MOVIMENTACAO",
    referencia_movimento = null,
    id_referencia = null,
    observacao = null,
  } = {},
) => {
  await client.query(
    `SELECT
      set_config('app.user_id', COALESCE($1::text, ''), true),
      set_config('app.origem_modulo', COALESCE($2, 'SISTEMA'), true),
      set_config('app.origem_tipo', COALESCE($3, 'MOVIMENTACAO'), true),
      set_config('app.referencia_movimento', COALESCE($4, ''), true),
      set_config('app.id_referencia', COALESCE($5::text, ''), true),
      set_config('app.observacao', COALESCE($6, ''), true)`,
    [
      id_operador,
      origem_modulo,
      origem_tipo,
      referencia_movimento,
      id_referencia,
      observacao,
    ],
  );
};

ensureEstoqueMovimentacoesTable();

pool.on("error", (err, client) => {
  console.error("❌ Erro inesperado no cliente do pool:", err);
  // Não precisa fazer nada - o pool vai lidar com a reconexão
});

pool.on("connect", (client) => {
  console.log("✅ Nova conexão estabelecida com o banco de dados");
});

pool.on("remove", (client) => {
  console.log("🔌 Conexão removida do pool");
});

// Middleware para autenticar token JWT
const autenticarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ message: "Acesso negado: Token não fornecido" });
  }

  jwt.verify(token, process.env.SECRET_KEY || "secreto", (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Token inválido ou expirado" });
    }
    req.user = user;
    next();
  });
};

// Permitir origens específicas
const allowedOrigins = [
  "http://localhost:4200", // Frontend Angular (ambiente de desenvolvimento)
  "http://127.0.0.1:4200",
  "http://192.168.10.134",
  "http://192.168.10.246:3000",
  "http://192.168.10.246:3001",
  "http://192.168.10.246",       // rede interna (HTTP)
  "http://192.168.10.246:8080",
  "http://localhost",
];

// ✅ CORS configurado corretamente (SEM redundância)
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requisições sem origin (como requisições do servidor)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS não permitido para esta origem: " + origin));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.options("*", cors()); // Responde a requisições preflight

// Middleware
app.use(bodyParser.json({ limit: "20mb" }));
app.use(bodyParser.urlencoded({ limit: "20mb", extended: true }));

// Rota de Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Configuração do rate limiting
const iaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30, // 30 requisições por operador
});

const BCRYPT_HASH_PREFIX = "$2";

function isBcryptHash(password) {
  return typeof password === "string" && password.startsWith(BCRYPT_HASH_PREFIX);
}

function sanitizeOperador(operador) {
  if (!operador) {
    return null;
  }

  const { senha, ...operadorSeguro } = operador;
  operadorSeguro.foto_url = normalizarFotoUrlOperador(operadorSeguro.foto_url);
  return operadorSeguro;
}

function normalizarFotoUrlOperador(fotoUrl) {
  if (!fotoUrl || typeof fotoUrl !== "string") {
    return null;
  }

  const marker = "/uploads/signature-photos/";
  const markerIndex = fotoUrl.indexOf(marker);

  if (markerIndex >= 0) {
    return fotoUrl.substring(markerIndex);
  }

  return fotoUrl;
}

function podeGerenciarOperadores(usuario) {
  if (!usuario) {
    return false;
  }

  return usuario.administrador || usuario.tipo_operador === "Gestão";
}

async function gerarHashSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function buscarOperadorSeguroPorId(id) {
  const result = await pool.query(
    `SELECT id, nome, email, administrador, turno, tipo_operador, data_cadastro, cargo, telefone, foto_url
     FROM operadores
     WHERE id = $1`,
    [id],
  );

  if (!result.rows[0]) {
    return null;
  }

  return {
    ...result.rows[0],
    foto_url: normalizarFotoUrlOperador(result.rows[0].foto_url),
  };
}

async function validarSenhaOperador(operador, senhaInformada) {
  if (!operador?.senha) {
    return false;
  }

  if (isBcryptHash(operador.senha)) {
    return bcrypt.compare(senhaInformada, operador.senha);
  }

  const senhaValida = senhaInformada === operador.senha;

  if (senhaValida) {
    try {
      const senhaHash = await gerarHashSenha(senhaInformada);
      await pool.query("UPDATE operadores SET senha = $1 WHERE id = $2", [
        senhaHash,
        operador.id,
      ]);
      operador.senha = senhaHash;
    } catch (error) {
      console.error("Erro ao atualizar hash da senha do operador:", error);
    }
  }

  return senhaValida;
}

// Rota de Login
app.post(
  "/operadores/login",
  [
    body("nome").notEmpty().withMessage("Nome é obrigatório"),
    body("senha").notEmpty().withMessage("Senha é obrigatória"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nome, senha } = req.body;

    try {
      const result = await pool.query(
        "SELECT * FROM operadores WHERE nome = $1",
        [nome],
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ message: "Operador não encontrado" });
      }

      const operador = result.rows[0];

      const senhaValida = await validarSenhaOperador(operador, senha);

      if (!senhaValida) {
        return res.status(400).json({ message: "Senha incorreta" });
      }

      // Definir expiração do token baseado no tipo de operador
      const isManagement = operador.tipo_operador && 
                          operador.tipo_operador.toUpperCase() === 'GESTÃO';
      const tokenExpiration = isManagement ? '2h' : '1h'; // 2h para gestão, 1h para operadores

      console.log(`🔑 Login: ${operador.nome} | Tipo: ${operador.tipo_operador} | Expiração: ${tokenExpiration}`);

      const token = jwt.sign(
        {
          id: operador.id,
          nome: operador.nome,
          administrador: operador.administrador,
          tipo_operador: operador.tipo_operador,
        },
        process.env.SECRET_KEY || "secreto",
        { expiresIn: tokenExpiration },
      );

      res.status(200).json({ token, operador: sanitizeOperador(operador) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao autenticar operador" });
    }
  },
);

async function processarNovaMensagem(dadosMensagem) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("📨 Processando nova mensagem:", dadosMensagem);

    // Inserir mensagem
    const result = await client.query(
      `INSERT INTO chat_mensagens 
       (sala_id, operador_id, mensagem, tipo, arquivo_nome, arquivo_url) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [
        dadosMensagem.sala_id,
        dadosMensagem.operador_id,
        dadosMensagem.mensagem,
        dadosMensagem.tipo || "texto",
        dadosMensagem.arquivo_nome,
        dadosMensagem.arquivo_url,
      ],
    );

    // Buscar participantes da sala (exceto o remetente)
    const participantes = await client.query(
      `SELECT operador_id FROM chat_participantes 
       WHERE sala_id = $1 AND operador_id != $2 AND ativo = true`,
      [dadosMensagem.sala_id, dadosMensagem.operador_id],
    );

    console.log(`👥 Participantes a notificar: ${participantes.rows.length}`);

    // Criar notificações para os participantes
    for (let participante of participantes.rows) {
      await client.query(
        `INSERT INTO chat_notificacoes 
         (operador_id, sala_id, mensagem_id) 
         VALUES ($1, $2, $3)`,
        [participante.operador_id, dadosMensagem.sala_id, result.rows[0].id],
      );

      // Enviar notificação em tempo real se o usuário estiver conectado
      const conexaoParticipante = conexoes.get(participante.operador_id);
      if (
        conexaoParticipante &&
        conexaoParticipante.readyState === WebSocket.OPEN
      ) {
        const mensagemCompleta = {
          ...result.rows[0],
          tipo: "nova_mensagem",
          operador_nome: "Remetente", // Você pode buscar o nome do operador se necessário
        };

        conexaoParticipante.send(JSON.stringify(mensagemCompleta));
        console.log(
          `🔔 Notificação enviada para operador ${participante.operador_id}`,
        );
      }
    }

    await client.query("COMMIT");

    console.log(
      `✅ Mensagem salva no banco - Sala: ${dadosMensagem.sala_id}, Operador: ${dadosMensagem.operador_id}`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao processar nova mensagem:", error);
  } finally {
    client.release();
  }
}

// =============================================
// ROTAS DO CHAT
// =============================================

const chatRouter = express.Router();

// Health check do chat
chatRouter.get("/health", (req, res) => {
  res.json({
    status: "OK",
    websocket: "Ativo",
    conexoes_ativas: conexoes.size,
    timestamp: new Date().toISOString(),
  });
});

// Teste do WebSocket
chatRouter.get("/test", (req, res) => {
  conexoes.forEach((ws, operadorId) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          tipo: "teste",
          mensagem: "Mensagem de teste do servidor",
          timestamp: new Date().toISOString(),
        }),
      );
    }
  });

  res.json({
    mensagem: "Mensagem de teste enviada para todos os clientes",
    clientes_conectados: conexoes.size,
  });
});

// Buscar salas do operador
chatRouter.get("/salas/:operadorId", async (req, res) => {
  try {
    const { operadorId } = req.params;
    console.log(`📋 Buscando salas para operador: ${operadorId}`);

    const result = await pool.query(
      `SELECT 
        cs.*,
        (SELECT COUNT(*) FROM chat_notificacoes cn 
         WHERE cn.sala_id = cs.id AND cn.operador_id = $1 AND cn.lida = false) as nao_lidas,
        (SELECT json_agg(p) FROM (
          SELECT cp.operador_id, o.nome as operador_nome
          FROM chat_participantes cp
          JOIN operadores o ON cp.operador_id = o.id
          WHERE cp.sala_id = cs.id AND cp.ativo = true
        ) p) as participantes,
        (SELECT row_to_json(m) FROM (
          SELECT * FROM chat_mensagens cm
          WHERE cm.sala_id = cs.id
          ORDER BY cm.data_envio DESC
          LIMIT 1
        ) m) as ultima_mensagem
       FROM chat_salas cs
       WHERE cs.id IN (
         SELECT sala_id FROM chat_participantes 
         WHERE operador_id = $1 AND ativo = true
       )
       ORDER BY (
         SELECT data_envio FROM chat_mensagens 
         WHERE sala_id = cs.id 
         ORDER BY data_envio DESC 
         LIMIT 1
       ) DESC NULLS LAST`,
      [operadorId],
    );

    console.log(
      `✅ ${result.rows.length} salas encontradas para operador ${operadorId}`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar salas:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Buscar mensagens de uma sala
chatRouter.get("/mensagens/:salaId", async (req, res) => {
  try {
    const { salaId } = req.params;
    console.log(`💬 Buscando mensagens da sala: ${salaId}`);

    const result = await pool.query(
      `SELECT 
        cm.*,
        o.nome as operador_nome
       FROM chat_mensagens cm
       JOIN operadores o ON cm.operador_id = o.id
       WHERE cm.sala_id = $1
       ORDER BY cm.data_envio ASC`,
      [salaId],
    );

    console.log(
      `✅ ${result.rows.length} mensagens encontradas na sala ${salaId}`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar mensagens:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Buscar notificações
chatRouter.get("/notificacoes/:operadorId", async (req, res) => {
  try {
    const { operadorId } = req.params;

    const result = await pool.query(
      `SELECT 
        cn.*,
        cs.nome as sala_nome,
        cm.mensagem,
        o.nome as operador_nome
       FROM chat_notificacoes cn
       JOIN chat_salas cs ON cn.sala_id = cs.id
       JOIN chat_mensagens cm ON cn.mensagem_id = cm.id
       JOIN operadores o ON cm.operador_id = o.id
       WHERE cn.operador_id = $1 AND cn.lida = false
       ORDER BY cn.data_notificacao DESC
       LIMIT 10`,
      [operadorId],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar notificações:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Marcar notificação como lida
chatRouter.put("/notificacoes/:notificacaoId/lida", async (req, res) => {
  try {
    const { notificacaoId } = req.params;

    await pool.query("UPDATE chat_notificacoes SET lida = true WHERE id = $1", [
      notificacaoId,
    ]);

    res.json({ message: "Notificação marcada como lida" });
  } catch (error) {
    console.error("❌ Erro ao marcar notificação como lida:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Marcar mensagens como lidas
chatRouter.put("/mensagens/:salaId/lidas", async (req, res) => {
  try {
    const { salaId } = req.params;
    const { operador_id } = req.body;

    await pool.query(
      `UPDATE chat_notificacoes 
       SET lida = true 
       WHERE sala_id = $1 AND operador_id = $2`,
      [salaId, operador_id],
    );

    res.json({ message: "Mensagens marcadas como lidas" });
  } catch (error) {
    console.error("❌ Erro ao marcar mensagens como lidas:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Contar mensagens não lidas
chatRouter.get("/nao-lidas/:operadorId", async (req, res) => {
  try {
    const { operadorId } = req.params;

    const result = await pool.query(
      "SELECT COUNT(*) as total FROM chat_notificacoes WHERE operador_id = $1 AND lida = false",
      [operadorId],
    );

    res.json(parseInt(result.rows[0].total));
  } catch (error) {
    console.error("❌ Erro ao contar mensagens não lidas:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Criar sala individual
chatRouter.post("/salas/individual", async (req, res) => {
  try {
    const { operador1_id, operador2_id } = req.body;

    // Verificar se já existe uma sala entre esses dois operadores
    const salaExistente = await pool.query(
      `SELECT cs.id 
       FROM chat_salas cs
       JOIN chat_participantes cp1 ON cs.id = cp1.sala_id
       JOIN chat_participantes cp2 ON cs.id = cp2.sala_id
       WHERE cs.tipo = 'individual' 
         AND cp1.operador_id = $1 
         AND cp2.operador_id = $2
         AND cp1.ativo = true 
         AND cp2.ativo = true`,
      [operador1_id, operador2_id],
    );

    if (salaExistente.rows.length > 0) {
      return res.json(salaExistente.rows[0]);
    }

    // Buscar nomes dos operadores para o nome da sala
    const operadores = await pool.query(
      `SELECT id, nome FROM operadores WHERE id IN ($1, $2) ORDER BY id`,
      [operador1_id, operador2_id],
    );

    const nomeSala = operadores.rows.map((op) => op.nome).join(" e ");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Criar nova sala
      const salaResult = await client.query(
        `INSERT INTO chat_salas (nome, tipo, criador_id) 
         VALUES ($1, 'individual', $2) 
         RETURNING *`,
        [nomeSala, operador1_id],
      );

      const salaId = salaResult.rows[0].id;

      // Adicionar participantes
      await client.query(
        `INSERT INTO chat_participantes (sala_id, operador_id) 
         VALUES ($1, $2), ($1, $3)`,
        [salaId, operador1_id, operador2_id],
      );

      await client.query("COMMIT");
      res.json(salaResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("❌ Erro ao criar sala individual:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Upload de arquivos para o chat
const storageChat = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/chat/";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const uploadChat = multer({
  storage: storageChat,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
});

const storageSignaturePhotos = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "uploads/signature-photos/";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const baseName = path
      .basename(file.originalname, ext)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `signature-${baseName || "photo"}-${uniqueSuffix}${ext}`);
  },
});

const uploadSignaturePhoto = multer({
  storage: storageSignaturePhotos,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Tipo de arquivo não suportado. Apenas JPG, JPEG, PNG e WEBP são permitidos.",
        ),
        false,
      );
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

const uploadSignaturePhotoFields = uploadSignaturePhoto.fields([
  { name: "foto", maxCount: 1 },
  { name: "photo", maxCount: 1 },
]);

chatRouter.post("/upload", uploadChat.single("arquivo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const arquivoUrl = `/uploads/chat/${req.file.filename}`;

    res.json({
      url: arquivoUrl,
      nome: req.file.originalname,
      tamanho: req.file.size,
      tipo: req.file.mimetype,
    });
  } catch (error) {
    console.error("❌ Erro no upload:", error);
    res.status(500).json({ error: "Erro no upload do arquivo" });
  }
});

const handleSignaturePhotoUpload = async (req, res) => {
  try {
    const uploadedFile = req.file || req.files?.foto?.[0] || req.files?.photo?.[0];

    if (!uploadedFile) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const fotoPath = `/uploads/signature-photos/${uploadedFile.filename}`;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.get("host");
    const fotoUrl = `${protocol}://${host}${fotoPath}`;

    res.json({
      success: true,
      url: fotoPath,
      absoluteUrl: fotoUrl,
      path: fotoPath,
      fileName: uploadedFile.filename,
      originalName: uploadedFile.originalname,
      size: uploadedFile.size,
      mimeType: uploadedFile.mimetype,
    });
  } catch (error) {
    console.error("❌ Erro no upload da assinatura:", error);
    res.status(500).json({ error: "Erro no upload da foto da assinatura" });
  }
};

app.post(
  "/api/signature-studio/upload-photo",
  uploadSignaturePhotoFields,
  handleSignaturePhotoUpload,
);

app.post(
  "/signature-studio/upload-photo",
  uploadSignaturePhotoFields,
  handleSignaturePhotoUpload,
);

// Usar o router do chat
app.use("/api/chat", chatRouter);

// Servir arquivos estáticos do chat
app.use("/uploads/chat", express.static("uploads/chat"));
app.use(
  "/uploads/signature-photos",
  express.static("uploads/signature-photos"),
);

// =============================================
// INICIALIZAÇÃO DO SERVIDOR
// =============================================

// Criar diretório de uploads se não existir

if (!fs.existsSync("uploads/chat")) {
  fs.mkdirSync("uploads/chat", { recursive: true });
  console.log("✅ Diretório uploads/chat criado");
}

if (!fs.existsSync("uploads/signature-photos")) {
  fs.mkdirSync("uploads/signature-photos", { recursive: true });
  console.log("✅ Diretório uploads/signature-photos criado");
}

function safeQuery(queryText, params) {
  return new Promise(async (resolve, reject) => {
    let client;
    try {
      client = await pool.connect();
      const result = await client.query(queryText, params);
      resolve(result);
    } catch (error) {
      console.error("❌ Erro na query:", error.message);

      // Se for erro de conexão, tentar reconectar
      if (
        error.code === "ECONNRESET" ||
        error.code === "ECONNREFUSED" ||
        error.code === "57P01"
      ) {
        console.warn("🔌 Tentando reconectar ao banco...");
        try {
          // Liberar cliente problemático
          if (client) {
            client.release(true); // Forçar liberação
          }

          // Tentar nova conexão
          const newClient = await pool.connect();
          const retryResult = await newClient.query(queryText, params);
          newClient.release();
          resolve(retryResult);
        } catch (retryError) {
          console.error("❌ Falha na reconexão:", retryError.message);
          reject(retryError);
        }
      } else {
        reject(error);
      }
    } finally {
      // Sempre liberar o cliente se existir
      if (client) {
        client.release();
      }
    }
  });
}

// Calcular paradas considerando apenas o dia atual
async function calcularParadasDoDia(idMaquina) {
  try {
    const agora = new Date();
    const inicioDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      0,
      0,
      0,
    );
    const fimDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      23,
      59,
      59,
    );

    console.log(
      `📅 Calculando paradas do dia: ${inicioDia.toISOString()} até ${fimDia.toISOString()}`,
    );

    // Query SQL corrigida - usando classificação correta das paradas
    const result = await pool.query(
      `
      WITH paradas_do_dia AS (
        SELECT 
          pp.id,
          pp.id_apontamento,
          pp.motivo_parada,
          pp.data_inicio,
          pp.data_fim,
          -- Considerar apenas a parte da parada que está dentro do dia
          CASE 
            WHEN pp.data_inicio < $1 THEN $1  -- Parada começou antes do dia
            ELSE pp.data_inicio 
          END as inicio_calculado,
          
          CASE 
            WHEN pp.data_fim IS NULL THEN $2  -- Parada ainda em andamento
            WHEN pp.data_fim > $2 THEN $2     -- Parada terminou depois do dia
            ELSE pp.data_fim 
          END as fim_calculado
          
        FROM paradas_producao pp
        INNER JOIN apontamento_producao ap ON pp.id_apontamento = ap.id
        WHERE ap.id_maquina = $3
          AND (
            -- Paradas que estavam ativas em algum momento do dia
            (pp.data_inicio <= $2 AND (pp.data_fim IS NULL OR pp.data_fim >= $1))
          )
      )
      SELECT 
        COUNT(*) as total_paradas,
        SUM(EXTRACT(EPOCH FROM (fim_calculado - inicio_calculado))) as tempo_total_paradas_segundos,
        SUM(
          CASE 
            -- PARADAS NÃO PROGRAMADAS (consomem disponibilidade)
            WHEN motivo_parada IN (
              'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
              'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
              'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
              'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima',
              'MANUTENÇÃO DO MOLDE', 'Problema de refrigeração', 'Troca matéria prima (cor)',
              'Troca ribbon'
            ) THEN EXTRACT(EPOCH FROM (fim_calculado - inicio_calculado))
            ELSE 0 
          END
        ) as tempo_paradas_nao_programadas_segundos,
        SUM(
          CASE 
            -- PARADAS PROGRAMADAS (NÃO consomem disponibilidade)
            WHEN motivo_parada IN (
              'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva', 
              'Intervalo para Café', 'Parada planejada'
            ) THEN EXTRACT(EPOCH FROM (fim_calculado - inicio_calculado))
            ELSE 0 
          END
        ) as tempo_paradas_programadas_segundos,
        -- Contagens por tipo
        COUNT(
          CASE WHEN motivo_parada IN (
            'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva', 
            'Intervalo para Café', 'Parada planejada'
          ) THEN 1 END
        ) as total_paradas_programadas,
        COUNT(
          CASE WHEN motivo_parada IN (
            'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
            'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
            'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
            'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima',
            'MANUTENÇÃO DO MOLDE', 'Problema de refrigeração', 'Troca matéria prima (cor)',
            'Troca ribbon'
          ) THEN 1 END
        ) as total_paradas_nao_programadas
      FROM paradas_do_dia
    `,
      [inicioDia, fimDia, idMaquina],
    );

    const dados = result.rows[0];

    console.log(`📊 Paradas do dia - Máquina ${idMaquina}:`, {
      total_paradas: dados.total_paradas,
      tempo_total_minutos: Math.round(dados.tempo_total_paradas_segundos / 60),
      tempo_nao_programado_minutos: Math.round(
        dados.tempo_paradas_nao_programadas_segundos / 60,
      ),
      tempo_programado_minutos: Math.round(
        dados.tempo_paradas_programadas_segundos / 60,
      ),
      paradas_nao_programadas: dados.total_paradas_nao_programadas,
      paradas_programadas: dados.total_paradas_programadas,
    });

    return {
      total_paradas: parseInt(dados.total_paradas) || 0,
      tempo_total_paradas_segundos:
        parseFloat(dados.tempo_total_paradas_segundos) || 0,
      tempo_paradas_nao_programadas_segundos:
        parseFloat(dados.tempo_paradas_nao_programadas_segundos) || 0,
      tempo_paradas_programadas_segundos:
        parseFloat(dados.tempo_paradas_programadas_segundos) || 0,
      total_paradas_nao_programadas:
        parseInt(dados.total_paradas_nao_programadas) || 0,
      total_paradas_programadas: parseInt(dados.total_paradas_programadas) || 0,
    };
  } catch (error) {
    console.error("❌ Erro ao calcular paradas do dia:", error);
    return {
      total_paradas: 0,
      tempo_total_paradas_segundos: 0,
      tempo_paradas_nao_programadas_segundos: 0,
      tempo_paradas_programadas_segundos: 0,
      total_paradas_nao_programadas: 0,
      total_paradas_programadas: 0,
    };
  }
}

async function calcularTempoProducaoReal(idApontamento) {
  try {
    // console.log(`📊 Calculando tempo real para apontamento: ${idApontamento}`);

    const result = await pool.query(
      `
      SELECT 
        ap.data_inicio,
        ap.data_fim,
        ap.status,
        COALESCE(SUM(EXTRACT(EPOCH FROM (pp.data_fim - pp.data_inicio))), 0) as tempo_paradas_segundos
      FROM apontamento_producao ap
      LEFT JOIN paradas_producao pp ON ap.id = pp.id_apontamento
      WHERE ap.id = $1
      GROUP BY ap.id, ap.data_inicio, ap.data_fim, ap.status
    `,
      [idApontamento],
    );

    if (result.rows.length === 0) {
      console.log("⚠️ Apontamento não encontrado:", idApontamento);
      return { tempo_real: "00:00:00", tempo_pausa: 0 };
    }

    const apontamento = result.rows[0];
    const agora = new Date();

    // Converter para Date objects se necessário
    const dataInicio = new Date(apontamento.data_inicio);
    let dataFim = apontamento.data_fim ? new Date(apontamento.data_fim) : null;

    if (apontamento.status === "FINALIZADO" && dataFim) {
      // Apontamento finalizado - calcular tempo total
      const tempoTotalSegundos = (dataFim - dataInicio) / 1000;
      const tempoProducaoSegundos = Math.max(
        0,
        tempoTotalSegundos - apontamento.tempo_paradas_segundos,
      );

      return {
        tempo_real: formatarTempo(tempoProducaoSegundos),
        tempo_pausa: apontamento.tempo_paradas_segundos,
      };
    } else {
      // Apontamento em andamento - calcular tempo corrente
      const tempoDecorridoSegundos = (agora - dataInicio) / 1000;
      const tempoProducaoSegundos = Math.max(
        0,
        tempoDecorridoSegundos - apontamento.tempo_paradas_segundos,
      );

      return {
        tempo_real: formatarTempo(tempoProducaoSegundos),
        tempo_pausa: apontamento.tempo_paradas_segundos,
      };
    }
  } catch (error) {
    console.error("❌ Erro ao calcular tempo de produção:", error.message);
    // Retornar valores padrão em caso de erro
    return { tempo_real: "00:00:00", tempo_pausa: 0 };
  }
}

function formatarTempo(segundos) {
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const segs = Math.floor(segundos % 60);

  return [
    horas.toString().padStart(2, "0"),
    minutos.toString().padStart(2, "0"),
    segs.toString().padStart(2, "0"),
  ].join(":");
}

// Rota para buscar produtos do AWORKS
app.get("/produtos-aworks", async (req, res) => {
  try {
    const { limit, offset } = req.query;
    let query =
      "SELECT produtoid, referencia_produto, ds_produto FROM produto where empresaid = 1";

    if (limit) query += ` LIMIT ${parseInt(limit)}`;
    if (offset) query += ` OFFSET ${parseInt(offset)}`;

    const result = await poolSeven.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar produtos do AWORKS:", err);
    res.status(500).json({
      message: "Erro ao buscar produtos do AWORKS",
      error: err.message,
    });
  }
});

// Corrigir a query de atualização - remover updated_at
app.put("/produtos/:id/padroes-tempo", autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tempo_padrao_montagem_segundos,
      tempo_padrao_embalagem_segundos,
      tempo_padrao_injecao_segundos,
      pecas_por_ciclo,
      meta_horaria_montagem,
      meta_horaria_embalagem,
      meta_horaria_injecao,
    } = req.body;

    // Query corrigida - removendo updated_at
    const result = await pool.query(
      `
      UPDATE produtos SET
        tempo_padrao_montagem_segundos = $1,
        tempo_padrao_embalagem_segundos = $2,
        tempo_padrao_injecao_segundos = $3,
        pecas_por_ciclo = $4,
        meta_horaria_montagem = $5,
        meta_horaria_embalagem = $6,
        meta_horaria_injecao = $7
      WHERE id = $8
      RETURNING *
    `,
      [
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        pecas_por_ciclo || 1,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Erro ao atualizar padrões:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Buscar produtos com padrões
app.get("/produtos-com-padroes", async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        p.*,
        COALESCE(p.meta_horaria_montagem, 0) as meta_montagem,
        COALESCE(p.meta_horaria_embalagem, 0) as meta_embalagem,
        COALESCE(p.meta_horaria_injecao, 0) as meta_injecao,
        COUNT(*) OVER() as total_count
      FROM produtos p
    `;
    let params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` WHERE (p.referencia_produto ILIKE $${paramCount} OR p.ds_produto ILIKE $${paramCount}) `;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY p.ds_produto LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      produtos: result.rows,
      total: result.rows[0]?.total_count || 0,
      page: parseInt(page),
      totalPages: Math.ceil((result.rows[0]?.total_count || 0) / limit),
    });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Criar novo planejamento
planejamentoRouter.get("/agendadas", autenticarToken, async (req, res) => {
  try {
    const hoje = new Date();
    const mesAnterior = new Date();
    mesAnterior.setMonth(hoje.getMonth() - 1);

    const proximoMes = new Date();
    proximoMes.setMonth(hoje.getMonth() + 1);

    const result = await pool.query(
      `
      SELECT 
        p.*,
        m.codigo as molde_codigo,
        m.descricao as molde_descricao,
        maq.descricao as maquina_descricao,
        (
          SELECT json_agg(json_build_object(
            'id', mp.id,
            'id_produto', mp.id_produto,
            'referencia_produto', mp.referencia_produto,
            'descricao_produto', mp.descricao_produto,
            'cavidades', mp.cavidades
          ))
          FROM moldes_produtos mp
          JOIN moldes_versoes mv ON mp.id_versao_molde = mv.id
          WHERE mv.id_molde = m.id
        ) as produtos_molde,
        (
          SELECT json_agg(json_build_object(
            'id', pr.id,
            'referencia_produto', pr.referencia_produto,
            'descricao_produto', pr.ds_produto
          ))
          FROM produtos pr
          JOIN moldes_produtos mp ON pr.id = mp.id_produto
          JOIN moldes_versoes mv ON mp.id_versao_molde = mv.id
          WHERE mv.id_molde = m.id
        ) as produtos
      FROM planejamento_producao p
      JOIN moldes m ON p.id_molde = m.id
      JOIN maquinas maq ON p.id_maquina = maq.id
      WHERE p.data_inicio BETWEEN $1 AND $2
      ORDER BY p.data_inicio
    `,
      [mesAnterior.toISOString(), proximoMes.toISOString()],
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro em /agendadas:", err);
    res.status(500).json({
      message: "Erro ao buscar produções agendadas",
      error: err.message,
    });
  }
});

// Listar todos os planejamentos
planejamentoRouter.get("/", autenticarToken, async (req, res) => {
  try {
    const { data_inicio, data_fim, status } = req.query;

    let query = `
      SELECT 
        p.*,
        m.codigo as molde_codigo,
        m.descricao as molde_descricao,
        maq.descricao as maquina_descricao,
        pr.referencia_produto,
        pr.ds_produto as produto_descricao
      FROM planejamento_producao p
      JOIN moldes m ON p.id_molde = m.id
      JOIN maquinas maq ON p.id_maquina = maq.id
      LEFT JOIN moldes_produtos mp ON mp.id_versao_molde IN (
        SELECT id FROM moldes_versoes WHERE id_molde = m.id
      )
      LEFT JOIN produtos pr ON mp.id_produto = pr.id
    `;

    const conditions = [];
    const params = [];

    if (data_inicio && data_fim) {
      conditions.push(
        `p.data_inicio BETWEEN $${params.length + 1} AND $${params.length + 2}`,
      );
      params.push(data_inicio, data_fim);
    }

    if (status) {
      conditions.push(`p.status = $${params.length + 1}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY p.data_inicio";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar planejamentos" });
  }
});

// Atualizar status do planejamento (usado no Kanban)
planejamentoRouter.patch(
  "/:id/status",
  autenticarToken,
  [
    body("status")
      .isIn(["planejado", "em_andamento", "concluido", "parado", "cancelado"])
      .withMessage("Status inválido"),
  ],
  async (req, res) => {
    // Identificador único para o request
    const requestId = uuidv4();
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id || "anonimo";

    // Log inicial da requisição
    console.log(
      `[${new Date().toISOString()}] [Request ${requestId}] Iniciando atualização de status`,
      {
        userId,
        planejamentoId: id,
        novoStatus: status,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip,
      },
    );

    console.log("Verificando configuração DeepSeek...");
    if (!server.env.DEEPSEEK_API_KEY) {
      console.error("ERRO CRÍTICO: DEEPSEEK_API_KEY não está definida");
      process.exit(1);
    } else {
      console.log("DeepSeek configurado (API key encontrada)");
    }

    // Validação dos dados
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorDetails = {
        requestId,
        errors: errors.array(),
        validationErrors: errors.mapped(),
        body: req.body,
        params: req.params,
      };

      console.error(
        `[${new Date().toISOString()}] [Request ${requestId}] Erro de validação`,
        errorDetails,
      );
      await registrarLog(
        "VALIDACAO_FALHOU",
        "Erro de validação ao atualizar status",
        errorDetails,
        id,
        userId,
      );

      return res.status(400).json({
        error: "Dados inválidos",
        details: errors.array(),
        requestId,
      });
    }

    try {
      // Log antes da consulta ao banco
      console.log(
        `[${new Date().toISOString()}] [Request ${requestId}] Buscando planejamento no banco`,
        { planejamentoId: id },
      );

      const planejamento = await pool.query(
        "SELECT status, id_molde, id_maquina FROM planejamento_producao WHERE id = $1",
        [id],
      );

      if (planejamento.rows.length === 0) {
        const errorMessage = `Planejamento não encontrado: ID ${id}`;
        console.error(
          `[${new Date().toISOString()}] [Request ${requestId}] ${errorMessage}`,
        );
        await registrarLog(
          "PLANEJAMENTO_NAO_ENCONTRADO",
          errorMessage,
          { planejamentoId: id },
          null,
          userId,
        );

        return res.status(404).json({
          error: errorMessage,
          requestId,
        });
      }

      const statusAtual = planejamento.rows[0].status;
      const transicoesValidas = {
        pendente: ["planejado", "cancelado", "em_andamento"],
        planejado: ["em_andamento", "cancelado"],
        em_andamento: ["concluido", "parado", "planejado"],
        parado: ["em_andamento", "cancelado"],
        concluido: [],
        cancelado: [],
      };

      // Log das informações do planejamento
      console.log(
        `[${new Date().toISOString()}] [Request ${requestId}] Status atual do planejamento`,
        {
          statusAtual,
          novoStatus: status,
          transicoesPermitidas: transicoesValidas[statusAtual],
        },
      );

      if (!transicoesValidas[statusAtual]?.includes(status)) {
        const errorMessage = `Transição de status inválida: de ${statusAtual} para ${status}`;
        console.error(
          `[${new Date().toISOString()}] [Request ${requestId}] ${errorMessage}`,
          {
            transicoesPermitidas: transicoesValidas[statusAtual],
          },
        );
        await registrarLog(
          "TRANSICAO_INVALIDA",
          errorMessage,
          {
            statusAtual,
            novoStatus: status,
            transicoesPermitidas: transicoesValidas[statusAtual],
          },
          id,
          userId,
        );

        return res.status(400).json({
          error: errorMessage,
          allowedTransitions: transicoesValidas[statusAtual],
          requestId,
        });
      }

      // Log antes da atualização
      console.log(
        `[${new Date().toISOString()}] [Request ${requestId}] Atualizando status no banco`,
        {
          planejamentoId: id,
          novoStatus: status,
        },
      );

      const result = await pool.query(
        "UPDATE planejamento_producao SET status = $1 WHERE id = $2 RETURNING *",
        [status, id],
      );

      if (status === "concluido") {
        console.log(
          `[${new Date().toISOString()}] [Request ${requestId}] Marcando como concluído - atualizando data_fim`,
        );
        await pool.query(
          "UPDATE planejamento_producao SET data_fim = NOW() WHERE id = $1",
          [id],
        );
      }

      // Log de sucesso
      const updated = result.rows[0];
      console.log(
        `[${new Date().toISOString()}] [Request ${requestId}] Status atualizado com sucesso`,
        {
          planejamentoId: id,
          statusAnterior: statusAtual,
          novoStatus: updated.status,
          dataAtualizacao: updated.data_atualizacao,
        },
      );
      await registrarLog(
        "STATUS_ATUALIZADO",
        "Status atualizado com sucesso",
        {
          statusAnterior: statusAtual,
          novoStatus: updated.status,
          planejamento: updated,
        },
        id,
        userId,
      );

      res.status(200).json({
        ...updated,
        requestId,
      });
    } catch (err) {
      // Log detalhado do erro
      console.error(
        `[${new Date().toISOString()}] [Request ${requestId}] Erro ao atualizar status`,
        {
          error: err.message,
          stack: err.stack,
          planejamentoId: id,
          novoStatus: status,
          userId,
        },
      );
      await registrarErro("ERRO_ATUALIZAR_STATUS", err, id, userId);

      res.status(500).json({
        error: "Erro interno ao atualizar status",
        message: err.message,
        requestId,
      });
    }
  },
);

// Atualizar planejamento completo
planejamentoRouter.put(
  "/:id",
  autenticarToken,
  [
    body("id_molde").optional().isInt(),
    body("id_maquina").optional().isInt(),
    body("quantidade").optional().isInt({ min: 1 }),
    body("data_inicio").optional().isISO8601(),
    body("turno").optional().isIn(["A", "B", "C"]),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { id_molde, id_maquina, quantidade, data_inicio, turno } = req.body;

    try {
      // Verificar se o planejamento existe
      const planejamento = await pool.query(
        "SELECT id, status FROM planejamento_producao WHERE id = $1",
        [id],
      );

      if (planejamento.rows.length === 0) {
        return res.status(404).json({ message: "Planejamento não encontrado" });
      }

      // Não permitir edição se já estiver em andamento ou concluído
      if (["em_andamento", "concluido"].includes(planejamento.rows[0].status)) {
        return res.status(400).json({
          message:
            "Não é possível editar um planejamento em andamento ou concluído",
        });
      }

      // Se quantidade ou molde foram alterados, recalcular tempo
      if (quantidade || id_molde) {
        const moldeId = id_molde || planejamento.rows[0].id_molde;
        const qtd = quantidade || planejamento.rows[0].quantidade;

        const tempoResult = await pool.query(
          `SELECT tempo_ciclo FROM moldes WHERE id = $1`,
          [moldeId],
        );

        if (tempoResult.rows.length === 0) {
          return res.status(404).json({ message: "Molde não encontrado" });
        }

        const tempo_ciclo = tempoResult.rows[0].tempo_ciclo || 30;
        const tempo_estimado = Math.ceil((qtd * tempo_ciclo) / 60);

        await pool.query(
          `UPDATE planejamento_producao 
         SET tempo_estimado = $1
         WHERE id = $2`,
          [tempo_estimado, id],
        );
      }

      // Atualizar os outros campos
      const result = await pool.query(
        `UPDATE planejamento_producao 
       SET 
         id_molde = COALESCE($1, id_molde),
         id_maquina = COALESCE($2, id_maquina),
         quantidade = COALESCE($3, quantidade),
         data_inicio = COALESCE($4, data_inicio),
         turno = COALESCE($5, turno)
       WHERE id = $6
       RETURNING *`,
        [id_molde, id_maquina, quantidade, data_inicio, turno, id],
      );

      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao atualizar planejamento" });
    }
  },
);

// Excluir planejamento
planejamentoRouter.delete("/:id", autenticarToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Verificar se o planejamento existe
    const planejamento = await pool.query(
      "SELECT status FROM planejamento_producao WHERE id = $1",
      [id],
    );

    if (planejamento.rows.length === 0) {
      return res.status(404).json({ message: "Planejamento não encontrado" });
    }

    // Não permitir exclusão se já estiver em andamento ou concluído
    if (["em_andamento", "concluido"].includes(planejamento.rows[0].status)) {
      return res.status(400).json({
        message:
          "Não é possível excluir um planejamento em andamento ou concluído",
      });
    }

    await pool.query("DELETE FROM planejamento_producao WHERE id = $1", [id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao excluir planejamento" });
  }
});

// Rota apontamento ativo
app.get("/api/apontamento/ativo", autenticarToken, async (req, res) => {
  try {
    const { id_maquina } = req.query;

    //console.log(`Buscando apontamento ativo para máquina: ${id_maquina}`) ;

    if (!id_maquina) {
      return res
        .status(400)
        .json({ error: "Parâmetro id_maquina é obrigatório" });
    }

    // Busca apontamento ativo específico para a máquina solicitada
    const result = await pool.query(
      `
      SELECT id, id_maquina, id_operador, id_produto, data_inicio 
      FROM apontamento_producao 
      WHERE id_maquina = $1
      AND status = 'EM_ANDAMENTO'
      ORDER BY data_inicio DESC 
      LIMIT 1
    `,
      [id_maquina],
    );

    /*  console.log(
       `Apontamento ativo para máquina ${id_maquina}:`,
       result.rows[0] || "Nenhum encontrado",
     ); */

    // Se encontrar apontamento, retorna ele
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({
        error: "Nenhum apontamento ativo encontrado para esta máquina",
      });
    }
  } catch (err) {
    console.error("Erro ao buscar apontamento ativo:", err);
    res.status(500).json({ error: "Erro no servidor" });
  }
});
// Nova rota para receber pulsos
app.post("/api/pulsos", autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { id_maquina, pulsos, device_id, id_apontamento, id_operador } =
      req.body;

    // Verifica se a máquina existe
    const maquinaResult = await client.query(
      "SELECT id FROM maquinas WHERE id = $1",
      [id_maquina],
    );

    if (maquinaResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Máquina não encontrada" });
    }

    // Insere os pulsos acumulados
    const result = await client.query(
      `INSERT INTO apontamento_pulsos 
       (id_maquina, pulsos, device_id, id_apontamento, id_operador) 
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        id_maquina,
        pulsos,
        device_id || null,
        id_apontamento || null,
        id_operador || null,
      ],
    );

    await client.query("COMMIT");

    // Atualiza o apontamento principal se existir
    if (id_apontamento) {
      try {
        await pool.query(
          `UPDATE apontamento_producao 
           SET quantidade_pecas = COALESCE(quantidade_pecas, 0) + $1
           WHERE id = $2`,
          [pulsos, id_apontamento],
        );
      } catch (err) {
        console.error("Erro ao atualizar apontamento principal:", err);
        // Não faz rollback, apenas registra o erro
        await registrarErro(
          "Erro ao atualizar apontamento principal",
          err,
          id_apontamento,
          id_operador,
        );
      }
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao processar pulsos:", err);

    res.status(500).json({
      error: "Erro no servidor",
      details:
        process.env.NODE_ENV === "development"
          ? {
              message: err.message,
              code: err.code,
            }
          : undefined,
    });
  } finally {
    client.release();
  }
});

// ========== NOVA ROTA: Criar Apontamento Automático ========== //
app.post("/api/apontamento/automatico", autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { id_maquina, id_operador, device_id } = req.body;

    console.log(
      `🔄 Iniciando apontamento automático - Máquina: ${id_maquina}, Operador: ${id_operador}`,
    );

    // 1. Buscar último produto usado nesta máquina
    const ultimoProdutoQuery = `
      SELECT id_produto 
      FROM apontamento_producao 
      WHERE id_maquina = $1 AND id_produto IS NOT NULL 
      ORDER BY data_inicio DESC 
      LIMIT 1
    `;

    const ultimoProdutoResult = await client.query(ultimoProdutoQuery, [
      id_maquina,
    ]);
    const id_produto = ultimoProdutoResult.rows[0]?.id_produto || null;

    console.log(`📦 Último produto encontrado: ${id_produto || "Nenhum"}`);

    // 2. Verificar se já existe apontamento automático em andamento
    const apontamentoExistenteQuery = `
      SELECT id FROM apontamento_producao 
      WHERE id_maquina = $1 AND status = 'EM_ANDAMENTO' 
      AND origem_automatica = true
      ORDER BY data_inicio DESC 
      LIMIT 1
    `;

    const apontamentoExistenteResult = await client.query(
      apontamentoExistenteQuery,
      [id_maquina],
    );

    let apontamentoId;
    let usandoExistente = false;

    if (apontamentoExistenteResult.rows.length > 0) {
      // Usar apontamento existente
      apontamentoId = apontamentoExistenteResult.rows[0].id;
      usandoExistente = true;
      console.log(
        `✅ Usando apontamento automático existente: ${apontamentoId}`,
      );
    } else {
      // Criar novo apontamento automático
      const result = await client.query(
        `INSERT INTO apontamento_producao 
         (id_operador, id_maquina, id_produto, data_inicio, status, origem_automatica, device_id) 
         VALUES ($1, $2, $3, NOW(), 'EM_ANDAMENTO', true, $4)
         RETURNING id`,
        [id_operador, id_maquina, id_produto, device_id],
      );

      apontamentoId = result.rows[0].id;
      console.log(`✅ Novo apontamento automático criado: ${apontamentoId}`);
    }

    await client.query("COMMIT");

    console.log(
      `🎯 Apontamento automático finalizado - ID: ${apontamentoId}, Produto: ${id_produto}`,
    );

    res.json({
      success: true,
      id: apontamentoId,
      id_produto: id_produto,
      usando_existente: usandoExistente,
      message: "Apontamento automático processado com sucesso",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao criar apontamento automático:", err);

    // Registrar erro no log do banco
    try {
      await registrarErro(
        "Erro ao criar apontamento automático",
        err,
        null,
        req.body.id_operador,
      );
    } catch (logError) {
      console.error("❌ Erro ao registrar log:", logError);
    }

    res.status(500).json({
      success: false,
      error: "Erro ao criar apontamento automático",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    client.release();
  }
});

// Rota para verificar se existe apontamento automático para transferência
app.get(
  "/api/apontamento/verificar-automatico/:maquinaId",
  autenticarToken,
  async (req, res) => {
    try {
      const { maquinaId } = req.params;

      const result = await pool.query(
        `
      SELECT id, quantidade_pecas, id_produto
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND status = 'EM_ANDAMENTO' 
      AND origem_automatica = true
      ORDER BY data_inicio DESC 
      LIMIT 1
    `,
        [maquinaId],
      );

      if (result.rows.length > 0) {
        res.json({
          existe_automatico: true,
          id_apontamento: result.rows[0].id,
          quantidade_pecas: result.rows[0].quantidade_pecas,
          id_produto: result.rows[0].id_produto,
        });
      } else {
        res.json({ existe_automatico: false });
      }
    } catch (err) {
      console.error("Erro ao verificar apontamento automático:", err);
      res.status(500).json({ error: "Erro no servidor" });
    }
  },
);

// Rota para transferir apontamento automático para manual
app.post("/api/apontamento/transferir", autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      id_apontamento_automatico,
      id_novo_operador,
      id_novo_produto,
      id_ordem_producao,
    } = req.body;

    // 1. Buscar dados do apontamento automático
    const apontamentoQuery = `
      SELECT id_maquina, quantidade_pecas 
      FROM apontamento_producao 
      WHERE id = $1 AND origem_automatica = true
    `;

    const apontamentoResult = await client.query(apontamentoQuery, [
      id_apontamento_automatico,
    ]);

    if (apontamentoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        error: "Apontamento automático não encontrado",
      });
    }

    const { id_maquina, quantidade_pecas } = apontamentoResult.rows[0];

    // 2. Criar novo apontamento manual com a quantidade transferida
    const novoApontamentoResult = await client.query(
      `INSERT INTO apontamento_producao 
       (id_operador, id_maquina, id_produto, id_ordem_producao, data_inicio, status, quantidade_pecas, origem_automatica) 
       VALUES ($1, $2, $3, $4, NOW(), 'EM_ANDAMENTO', $5, false)
       RETURNING id`,
      [
        id_novo_operador,
        id_maquina,
        id_novo_produto,
        id_ordem_producao,
        quantidade_pecas,
      ],
    );

    const novoApontamentoId = novoApontamentoResult.rows[0].id;

    // 3. Transferir pulsos
    await client.query(
      `UPDATE apontamento_pulsos 
       SET id_apontamento = $1, id_operador = $2
       WHERE id_apontamento = $3`,
      [novoApontamentoId, id_novo_operador, id_apontamento_automatico],
    );

    // 4. Finalizar apontamento automático
    await client.query(
      `UPDATE apontamento_producao 
       SET status = 'FINALIZADO', 
           data_fim = NOW(),
           motivo_transferencia = 'Transferido para apontamento manual'
       WHERE id = $1`,
      [id_apontamento_automatico],
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      id_novo_apontamento: novoApontamentoId,
      quantidade_transferida: quantidade_pecas,
      message: `Transferência realizada: ${quantidade_pecas} peças movidas para novo apontamento`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao transferir apontamento:", err);
    res.status(500).json({
      success: false,
      error: "Erro ao transferir apontamento",
    });
  } finally {
    client.release();
  }
});

// Rota otimizada para receber batches de pulsos
app.post("/api/pulsos/batch", autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { id_maquina, pulsos, device_id, id_apontamento, timestamp } =
      req.body;

    // Validar dados do batch
    if (!id_maquina || !pulsos || pulsos <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Dados do batch inválidos" });
    }

    // Inserir batch de pulsos
    const result = await client.query(
      `INSERT INTO apontamento_pulsos 
       (id_maquina, pulsos, device_id, id_apontamento, created_at) 
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        id_maquina,
        pulsos,
        device_id,
        id_apontamento || null,
        timestamp ? new Date(timestamp) : new Date(),
      ],
    );

    // Atualizar apontamento principal se existir
    if (id_apontamento) {
      await client.query(
        `UPDATE apontamento_producao 
         SET quantidade_pecas = COALESCE(quantidade_pecas, 0) + $1,
             ultima_atualizacao = NOW()
         WHERE id = $2`,
        [pulsos, id_apontamento],
      );
    }

    await client.query("COMMIT");

    res.status(200).json({
      success: true,
      batch: result.rows[0],
      message: `Batch de ${pulsos} pulsos processado com sucesso`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao processar batch de pulsos:", err);

    res.status(500).json({
      error: "Erro ao processar batch de pulsos",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    client.release();
  }
});

// Rota para buscar quantidade de peças
app.get(
  "/apontamento/:id/quantidade-pecas",
  autenticarToken,
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        "SELECT quantidade_pecas FROM apontamento_producao WHERE id = $1",
        [id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Apontamento não encontrado" });
      }

      res.json({ quantidade_pecas: result.rows[0].quantidade_pecas });
    } catch (err) {
      console.error("Erro ao buscar quantidade de peças:", err);
      res.status(500).json({ message: "Erro no servidor" });
    }
  },
);

app.post("/api/pulsos-torneiras", autenticarToken, async (req, res) => {
  const { id_apontamento } = req.body;

  try {
    // Atualiza diretamente o apontamento (+1 unidade)
    const result = await pool.query(
      `
      UPDATE apontamento_producao 
      SET quantidade_pecas = COALESCE(quantidade_pecas, 0) + 1
      WHERE id = $1
      RETURNING id, quantidade_pecas
    `,
      [id_apontamento],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Apontamento não encontrado" });
    }

    res.status(200).json({
      success: true,
      apontamento: result.rows[0],
    });
  } catch (err) {
    console.error("Erro ao atualizar apontamento:", err);
    res.status(500).json({
      error: "Erro no servidor",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

async function executeQueryWithRetry(queryText, params, maxRetries = 3) {
  let retries = 0;

  while (retries <= maxRetries) {
    try {
      const result = await pool.query(queryText, params);
      return result;
    } catch (error) {
      retries++;

      if (
        error.code === "ECONNRESET" ||
        error.code === "ECONNREFUSED" ||
        error.code === "57P01"
      ) {
        console.warn(
          `⚠️ Tentativa ${retries}/${maxRetries}: Reconectando ao banco...`,
        );

        if (retries <= maxRetries) {
          // Esperar um tempo antes de tentar novamente (backoff exponencial)
          await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
          continue;
        }
      }

      // Se não for erro de conexão ou se excedeu as tentativas, lançar o erro
      throw error;
    }
  }
}

async function calcularEficienciaReal(apontamentoId) {
  try {
    const result = await pool.query(
      `
      SELECT 
        ap.*,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos, 
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao,
        p.pecas_por_ciclo,
        m.tipo_maquina,
        EXTRACT(EPOCH FROM (ap.data_fim - ap.data_inicio)) as tempo_total_segundos,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (pp.data_fim - pp.data_inicio))), 0)
         FROM paradas_producao pp 
         WHERE pp.id_apontamento = ap.id) as tempo_paradas_segundos
      FROM apontamento_producao ap
      JOIN produtos p ON ap.id_produto = p.id
      JOIN maquinas m ON ap.id_maquina = m.id
      WHERE ap.id = $1
    `,
      [apontamentoId],
    );

    if (result.rows.length === 0) return null;

    const data = result.rows[0];
    const tempo_efetivo_segundos =
      data.tempo_total_segundos - data.tempo_paradas_segundos;

    // Determinar meta baseada no tipo de máquina
    let meta_horaria, tempo_padrao_segundos;

    switch (data.tipo_maquina.toUpperCase()) {
      case "MONTAGEM":
        meta_horaria = data.meta_horaria_montagem;
        tempo_padrao_segundos = data.tempo_padrao_montagem_segundos;
        break;
      case "EMBALAGEM":
        meta_horaria = data.meta_horaria_embalagem;
        tempo_padrao_segundos = data.tempo_padrao_embalagem_segundos;
        break;
      case "INJETORA":
        meta_horaria = data.meta_horaria_injecao;
        tempo_padrao_segundos = data.tempo_padrao_injecao_segundos;
        break;
      default:
        meta_horaria = 100; // Meta padrão
        tempo_padrao_segundos = 36; // 36 segundos por peça = 100 peças/hora
    }

    // Calcular eficiência de várias formas
    const eficiencia = {
      // Método 1: Baseado na meta horária
      por_meta_horaria:
        meta_horaria > 0
          ? data.quantidade_pecas /
            (tempo_efetivo_segundos / 3600) /
            meta_horaria
          : 0,

      // Método 2: Baseado no tempo padrão por peça
      por_tempo_padrao:
        tempo_padrao_segundos > 0
          ? (data.quantidade_pecas * tempo_padrao_segundos) /
            tempo_efetivo_segundos
          : 0,

      // Método 3: Para injeção - considerando ciclos
      por_ciclo:
        data.tipo_maquina.toUpperCase() === "INJETORA" &&
        data.pecas_por_ciclo > 0
          ? ((data.quantidade_pecas / data.pecas_por_ciclo) *
              tempo_padrao_segundos) /
            tempo_efetivo_segundos
          : 0,
    };

    // Usar o método mais apropriado
    let eficiencia_final = eficiencia.por_meta_horaria;
    if (eficiencia.por_tempo_padrao > 0) {
      eficiencia_final = eficiencia.por_tempo_padrao;
    }
    if (eficiencia.por_ciclo > 0) {
      eficiencia_final = eficiencia.por_ciclo;
    }

    return {
      eficiencia: Math.min(Math.max(eficiencia_final, 0), 2), // Limitar entre 0% e 200%
      tempo_efetivo_horas: tempo_efetivo_segundos / 3600,
      tempo_paradas_horas: data.tempo_paradas_segundos / 3600,
      meta_horaria,
      tempo_padrao_segundos,
      tipo_processo: data.tipo_maquina,
    };
  } catch (error) {
    console.error("Erro ao calcular eficiência:", error);
    return null;
  }
}

// Calcular tempo estimado
planejamentoRouter.get("/calcular-tempo", autenticarToken, async (req, res) => {
  const { id_molde, quantidade } = req.query;

  try {
    const molde = await pool.query(
      "SELECT tempo_ciclo FROM moldes WHERE id = $1",
      [id_molde],
    );

    if (molde.rows.length === 0) {
      return res.status(404).json({ message: "Molde não encontrado" });
    }

    const tempo_ciclo = molde.rows[0].tempo_ciclo || 30; // 30 segundos padrão
    const tempo_estimado = Math.ceil((quantidade * tempo_ciclo) / 60); // em minutos

    res.json({ tempo_estimado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao calcular tempo" });
  }
});

// Rota otimizada para dashboard - busca todos os dados de uma máquina
app.get(
  "/api/dashboard-maquina/:id_maquina",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_maquina } = req.params;

      console.log(`📊 Buscando dados completos para máquina ${id_maquina}`);

      // Executar todas as consultas em paralelo
      const [oeeData, statusData, produtoData] = await Promise.all([
        calcularOEE(parseInt(id_maquina)),
        buscarStatusMaquina(id_maquina),
        buscarProdutoAtual(id_maquina),
      ]);

      res.json({
        oee: oeeData,
        status: statusData,
        produto: produtoData,
      });
    } catch (error) {
      console.error(
        `❌ Erro ao buscar dados da máquina ${req.params.id_maquina}:`,
        error,
      );
      res.status(500).json({
        error: "Erro ao buscar dados do dashboard",
        details: error.message,
      });
    }
  },
);

// Função auxiliar para buscar status da máquina
async function buscarStatusMaquina(idMaquina) {
  try {
    const statusResult = await pool.query(
      `
      SELECT status, data_inicio, motivo_parada_maquina
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND (status IN ('EM_ANDAMENTO', 'PAUSADO', 'MAQUINA_PARADA') 
           OR (status = 'FINALIZADO' AND data_fim > NOW() - INTERVAL '5 minutes'))
      ORDER BY data_inicio DESC 
      LIMIT 1
    `,
      [idMaquina],
    );

    const status = statusResult.rows[0]
      ? statusResult.rows[0].status
      : "PARADA";
    const motivo = statusResult.rows[0]
      ? statusResult.rows[0].motivo_parada_maquina
      : "";

    // Buscar pulsos recentes para animação
    const pulsosResult = await pool.query(
      `
      SELECT COUNT(*) as pulsos_recentes
      FROM apontamento_pulsos 
      WHERE id_maquina = $1 
      AND timestamp > NOW() - INTERVAL '1 minute'
    `,
      [idMaquina],
    );

    const pulsosRecentes = parseInt(pulsosResult.rows[0].pulsos_recentes);

    return {
      status,
      motivo,
      pulsosRecentes,
      ultimaAtualizacao: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Erro ao buscar status da máquina:", error);
    return {
      status: "PARADA",
      motivo: "",
      pulsosRecentes: 0,
      ultimaAtualizacao: new Date().toISOString(),
    };
  }
}

// Classificação de paradas
const CLASSIFICACAO_PARADAS = {
  // PARADAS PROGRAMADAS (não consomem disponibilidade)
  "Horário de refeição": "PROGRAMADA",
  "Intervalo para Café": "PROGRAMADA",
  "Parada planejada": "PROGRAMADA",
  "Troca de Turno": "PROGRAMADA",
  "Manutenção Preventiva": "PROGRAMADA",

  // PARADAS NÃO PROGRAMADAS (consomem disponibilidade)
  "Manutenção - Máquina": "NAO_PROGRAMADA",
  "Aguardando definição da qualidade": "NAO_PROGRAMADA",
  "Troca de Bobina": "NAO_PROGRAMADA",
  "Problema no ar": "NAO_PROGRAMADA",
  "Falta de produto": "NAO_PROGRAMADA",
  "Aguardando Reabastecimento": "NAO_PROGRAMADA",
  "Espera - Manutenção Máquina": "NAO_PROGRAMADA",
  "Espera - Manutenção Molde": "NAO_PROGRAMADA",
  Setup: "NAO_PROGRAMADA",
  "Falta de colaborador": "NAO_PROGRAMADA",
  "Falta de energia": "NAO_PROGRAMADA",
  "Falta de matéria prima": "NAO_PROGRAMADA",
  "MANUTENÇÃO DO MOLDE": "NAO_PROGRAMADA",
  "Problema de refrigeração": "NAO_PROGRAMADA",
  "Troca matéria prima (cor)": "NAO_PROGRAMADA",
  "Troca ribbon": "NAO_PROGRAMADA",
};

function classificarParada(motivoParada) {
  const classificacao = CLASSIFICACAO_PARADAS[motivoParada];

  if (!classificacao) {
    console.warn(
      `⚠️ Motivo de parada não mapeado: "${motivoParada}" - considerando como NÃO PROGRAMADA`,
    );
    return "NAO_PROGRAMADA";
  }

  return classificacao;
}

// Função auxiliar para buscar produto atual
async function buscarProdutoAtual(idMaquina) {
  try {
    const result = await pool.query(
      `
      SELECT 
        ap.id_produto,
        p.ds_produto,
        p.referencia_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao,
        p.pecas_por_ciclo,
        ap.quantidade_pecas,
        ap.data_inicio,
        ap.status
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND ap.status IN ('EM_ANDAMENTO', 'PAUSADO')
      ORDER BY ap.data_inicio DESC
      LIMIT 1
    `,
      [idMaquina],
    );

    if (result.rows.length === 0) {
      return {
        em_producao: false,
        mensagem: "Nenhum produto em produção",
      };
    }

    const apontamento = result.rows[0];

    // Calcular eficiência atual
    const tempo_decorrido =
      (new Date() - new Date(apontamento.data_inicio)) / 1000;
    const pecas_produzidas = apontamento.quantidade_pecas || 0;

    // Determinar tempo padrão baseado no tipo de máquina
    const maquinaResult = await pool.query(
      "SELECT tipo_maquina FROM maquinas WHERE id = $1",
      [idMaquina],
    );
    const tipo_maquina = maquinaResult.rows[0]?.tipo_maquina;

    const tempo_ideal_por_peca = calcularTempoIdealProduto(
      apontamento,
      tipo_maquina,
    );
    const eficiencia_atual =
      tempo_ideal_por_peca && tempo_decorrido > 0
        ? ((pecas_produzidas * tempo_ideal_por_peca) / tempo_decorrido) * 100
        : 0;

    return {
      em_producao: true,
      produto: {
        id: apontamento.id_produto,
        descricao: apontamento.ds_produto,
        referencia: apontamento.referencia_produto,
        tempo_ideal_por_peca: tempo_ideal_por_peca,
        meta_horaria: getMetaHoraria(apontamento, tipo_maquina),
        pecas_por_ciclo: apontamento.pecas_por_ciclo || 1,
      },
      producao_atual: {
        quantidade_pecas: pecas_produzidas,
        tempo_decorrido_minutos: Math.round(tempo_decorrido / 60),
        eficiencia_atual: Math.max(0, eficiencia_atual),
        status: apontamento.status,
      },
    };
  } catch (error) {
    console.error("Erro ao buscar produto atual:", error);
    return {
      em_producao: false,
      mensagem: "Erro ao buscar dados do produto",
    };
  }
}
async function calcularQualidadeDia(idMaquina, inicioDia, fimDia) {
  try {
    const qualidadeResult = await pool.query(
      `
      SELECT 
        COALESCE(SUM(pecas_boas), 0) as pecas_boas,
        COALESCE(SUM(quantidade_pecas), 0) as pecas_totais,
        COALESCE(SUM(refugo_kg), 0) as refugo_total
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND data_inicio >= $2
      AND data_inicio <= $3
      AND status = 'FINALIZADO'
      AND id_produto IS NOT NULL
      AND quantidade_pecas > 0
    `,
      [idMaquina, inicioDia, fimDia],
    );

    const { pecas_boas, pecas_totais, refugo_total } = qualidadeResult.rows[0];

    let qualidade = 100;
    if (pecas_totais > 0) {
      if (pecas_boas > 0) {
        qualidade = (pecas_boas / pecas_totais) * 100;
      } else {
        const pecas_com_defeito = refugo_total * 10;
        qualidade = Math.max(
          85,
          ((pecas_totais - pecas_com_defeito) / pecas_totais) * 100,
        );
      }
    }

    return Math.min(100, Math.max(0, qualidade));
  } catch (error) {
    console.error("Erro ao calcular qualidade:", error);
    return 100; // Fallback
  }
}

// ✅ FUNÇÃO ESPECÍFICA PARA DASHBOARD TEMPO REAL
async function calcularOEETempoReal(idMaquina) {
  try {
    const agora = new Date();

    /*     console.log(
          `🔍 OEE TEMPO REAL - Máquina ${idMaquina} às ${agora.toLocaleString("pt-BR")}`,
        ); */

    // Período do dia atual
    const inicioDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      0,
      0,
      0,
    );
    const fimDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      23,
      59,
      59,
    );

    // 1. Buscar informações da máquina
    const maquinaResult = await pool.query(
      `
      SELECT tipo_maquina, descricao 
      FROM maquinas 
      WHERE id = $1
    `,
      [idMaquina],
    );

    if (maquinaResult.rows.length === 0) {
      return getOeeDataDefault();
    }

    const { tipo_maquina, descricao } = maquinaResult.rows[0];

    // 2. BUSCAR ESTADO ATUAL DA MÁQUINA (sintaxe PostgreSQL correta)
    const estadoAtualResult = await pool.query(
      `
      SELECT 
        status,
        data_inicio,
        data_fim,
        motivo_parada_maquina,
        id_produto,
        quantidade_pecas
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND (
        status IN ('EM_ANDAMENTO', 'PAUSADO', 'MAQUINA_PARADA')
        OR (status = 'FINALIZADO' AND data_fim > NOW() - INTERVAL '5 minutes')
      )
      ORDER BY data_inicio DESC 
      LIMIT 1
    `,
      [idMaquina],
    );

    const estadoAtual = estadoAtualResult.rows[0];
    console.log(
      `🏭 Estado atual máquina ${idMaquina}:`,
      estadoAtual ? estadoAtual.status : "INATIVA",
    );

    // 3. CALCULAR PARADAS ATÉ AGORA
    const paradasAteAgora = await calcularParadasPeriodo(
      idMaquina,
      inicioDia,
      agora,
    );

    // 4. CALCULAR TEMPO PRODUTIVO ATÉ AGORA
    const tempoAteAgoraResult = await pool.query(
      `
      SELECT 
        -- Tempo produtivo REAL até agora
        COALESCE(SUM(
          CASE 
            WHEN (id_produto IS NOT NULL AND quantidade_pecas > 0) 
                 OR (id_produto IS NOT NULL AND quantidade_pecas IS NULL AND status = 'EM_ANDAMENTO') THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_produtivo_segundos,

        -- Tempo total até agora (desde início do dia)
        EXTRACT(EPOCH FROM ($2 - $1)) as tempo_decorrido_segundos

      FROM apontamento_producao 
      WHERE id_maquina = $3 
      AND (
        (data_inicio BETWEEN $1 AND $2)
        OR (data_fim BETWEEN $1 AND $2)
        OR (data_inicio < $1 AND (data_fim IS NULL OR data_fim > $1))
        OR (data_inicio >= $1 AND data_fim IS NULL)
      )
    `,
      [inicioDia, agora, idMaquina],
    );

    const { tempo_produtivo_segundos, tempo_decorrido_segundos } =
      tempoAteAgoraResult.rows[0];

    /*     console.log(`⏱️ Tempos até agora:`, {
          produtivo: `${Math.round(tempo_produtivo_segundos / 60)}min`,
          decorrido: `${Math.round(tempo_decorrido_segundos / 60)}min`,
          paradas_nao_programadas: `${Math.round(paradasAteAgora.tempo_paradas_nao_programadas_segundos / 60)}min`,
        }); */

    // 5. DISPONIBILIDADE TEMPO REAL
    let disponibilidade = 0;

    // Tempo operacional = tempo decorrido - paradas programadas
    const tempo_operacional_segundos = Math.max(
      0,
      tempo_decorrido_segundos -
        paradasAteAgora.tempo_paradas_programadas_segundos,
    );

    if (tempo_operacional_segundos > 0) {
      disponibilidade =
        (tempo_produtivo_segundos / tempo_operacional_segundos) * 100;
    }

    // ✅ CORREÇÃO: Se disponibilidade for 0 mas há produção, ajustar
    if (disponibilidade === 0 && tempo_produtivo_segundos > 0) {
      disponibilidade = Math.min(
        95,
        (tempo_produtivo_segundos / tempo_decorrido_segundos) * 100,
      );
    }

    disponibilidade = Math.min(100, Math.max(0, disponibilidade));
    //console.log(`📊 Disponibilidade: ${disponibilidade.toFixed(2)}%`);

    // 6. PERFORMANCE TEMPO REAL (SIMPLIFICADA)

    // ✅ SE MÁQUINA ESTÁ PRODUZINDO AGORA, CALCULAR EFICIÊNCIA ATUAL TAMBÉM
    let eficiencia_atual = 0;
    let performance = 0;
    let tempo_ideal_total_segundos = 0;
    let tempo_total_producao_segundos = 0;
    let pecas_produzidas_calculadas = 0;
    let pecas_produzidas = 0;

    const performanceResult = await pool.query(
      `
  SELECT 
    ap.id,
    ap.id_produto,
    ap.quantidade_pecas,
    ap.data_inicio,
    ap.data_fim,
    ap.status,
    p.ds_produto,
    p.tempo_padrao_montagem_segundos,
    p.tempo_padrao_embalagem_segundos,
    p.tempo_padrao_injecao_segundos,
    p.meta_horaria_montagem,
    p.meta_horaria_embalagem,
    p.meta_horaria_injecao
  FROM apontamento_producao ap
  LEFT JOIN produtos p ON ap.id_produto = p.id
  WHERE ap.id_maquina = $1 
  AND ap.id_produto IS NOT NULL
  AND (
    (ap.data_inicio BETWEEN $2 AND $3)
    OR (ap.data_fim BETWEEN $2 AND $3)
    OR (ap.data_inicio < $2 AND (ap.data_fim IS NULL OR ap.data_fim > $2))
  )
  AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
  ORDER BY ap.data_inicio DESC
`,
      [idMaquina, inicioDia, agora],
    );

    /*     console.log(
          `🔍 Performance: ${performanceResult.rows.length} apontamentos encontrados`,
        ); */

    if (performanceResult.rows.length > 0) {
      for (const apontamento of performanceResult.rows) {
        const inicio_apontamento = new Date(apontamento.data_inicio);
        const fim_apontamento = apontamento.data_fim
          ? new Date(apontamento.data_fim)
          : agora;

        // Calcular tempo dentro do período do dia
        const inicio_periodo = new Date(
          Math.max(inicio_apontamento.getTime(), inicioDia.getTime()),
        );
        const fim_periodo = new Date(
          Math.min(fim_apontamento.getTime(), agora.getTime()),
        );

        const tempo_apontamento_segundos = Math.max(
          0,
          (fim_periodo - inicio_periodo) / 1000,
        );

        if (tempo_apontamento_segundos > 0) {
          tempo_total_producao_segundos += tempo_apontamento_segundos;

          const pecas_apontamento = apontamento.quantidade_pecas || 0;
          pecas_produzidas_calculadas += pecas_apontamento;

          // Calcular tempo ideal
          const tempo_ideal = calcularTempoIdealProduto(
            apontamento,
            tipo_maquina,
          );

          if (tempo_ideal && pecas_apontamento > 0) {
            tempo_ideal_total_segundos += pecas_apontamento * tempo_ideal;
          }

          /*           console.log(
                      `📦 ${apontamento.ds_produto}: ${pecas_apontamento} peças em ${Math.round(tempo_apontamento_segundos / 60)}min (ideal: ${tempo_ideal}s/peça)`,
                    ); */
        }
      }

      // ✅ PERFORMANCE CORRETA: (Tempo Ideal Total / Tempo Real Total) × 100
      performance =
        tempo_total_producao_segundos > 0
          ? (tempo_ideal_total_segundos / tempo_total_producao_segundos) * 100
          : 0;

      /* console.log(
        `⚡ Performance cálculo: ${tempo_ideal_total_segundos.toFixed(0)}s ideal / ${tempo_total_producao_segundos.toFixed(0)}s real = ${performance.toFixed(2)}%`,
      ); */
    } else {
      /*  console.log(
         `⚠️ Sem apontamentos de performance para máquina ${idMaquina}`,
       ); */
      performance = 0;
    }

    performance = Math.max(0, performance); // Permitir valores acima de 150%
    // 7. QUALIDADE (usando a função auxiliar)
    let qualidade = await calcularQualidadeDia(idMaquina, inicioDia, fimDia);
    console.log(`✅ Qualidade: ${qualidade.toFixed(2)}%`);

    // 8. OEE TOTAL
    const oee = (disponibilidade * performance * qualidade) / 10000;
    /*   console.log(`🎯 ESTRUTURA FINAL OEE máquina ${idMaquina}:`, {
        disponibilidade: disponibilidade,
        performance: performance,
        qualidade: qualidade,
        oee: oee,
        metricas: {
          tempo_produtivo_minutos: Math.round(tempo_produtivo_segundos / 60),
          tempo_decorrido_minutos: Math.round(tempo_decorrido_segundos / 60),
          tempo_paradas_nao_programadas_minutos: Math.round(
            paradasAteAgora.tempo_paradas_nao_programadas_segundos / 60,
          ),
          pecas_produzidas: pecas_produzidas,
          eficiencia_atual: eficiencia_atual,
          // ✅ ADICIONE ESTAS DUAS MÉTRICAS:
          tempo_ideal_minutos: Math.round(tempo_ideal_total_segundos / 60), // ← ADICIONE
          tempo_real_minutos: Math.round(tempo_total_producao_segundos / 60), // ← ADICIONE
          estado_atual: estadoAtual ? estadoAtual.status : "INATIVA",
          ultima_atualizacao: agora.toISOString(),
        },
        tipo_maquina: tipo_maquina,
      }); */

    // ✅ GARANTIR QUE A ESTRUTURA ESTÁ CORRETA
    return {
      disponibilidade: disponibilidade,
      performance: performance,
      qualidade: qualidade,
      oee: oee,
      metricas: {
        tempo_produtivo_minutos: Math.round(tempo_produtivo_segundos / 60),
        tempo_decorrido_minutos: Math.round(tempo_decorrido_segundos / 60),
        tempo_paradas_nao_programadas_minutos: Math.round(
          paradasAteAgora.tempo_paradas_nao_programadas_segundos / 60,
        ),
        pecas_produzidas: pecas_produzidas,
        eficiencia_atual: eficiencia_atual,
        // ✅ ADICIONE ESTAS DUAS MÉTRICAS NO RETORNO TAMBÉM:
        tempo_ideal_minutos: Math.round(tempo_ideal_total_segundos / 60), // ← ADICIONE
        tempo_real_minutos: Math.round(tempo_total_producao_segundos / 60), // ← ADICIONE
        estado_atual: estadoAtual ? estadoAtual.status : "INATIVA",
        ultima_atualizacao: agora.toISOString(),
      },
      tipo_maquina: tipo_maquina,
    };
  } catch (error) {
    console.error("❌ Erro ao calcular OEE tempo real:", error);
    return getOeeDataDefault();
  }
}

async function calcularEficienciaAtual(
  idMaquina,
  estadoAtual,
  tipo_maquina,
  agora,
) {
  try {
    const apontamentoAtual = await pool.query(
      `
      SELECT 
        ap.id_produto,
        ap.quantidade_pecas,
        ap.data_inicio,
        p.ds_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND ap.status = 'EM_ANDAMENTO'
      ORDER BY ap.data_inicio DESC
      LIMIT 1
    `,
      [idMaquina],
    );

    if (apontamentoAtual.rows.length === 0) {
      return 0;
    }

    const apontamento = apontamentoAtual.rows[0];
    const tempo_decorrido = (agora - new Date(apontamento.data_inicio)) / 1000;
    const pecas_produzidas = apontamento.quantidade_pecas || 0;

    const tempo_ideal = calcularTempoIdealProduto(apontamento, tipo_maquina);

    if (tempo_ideal && tempo_decorrido > 0 && pecas_produzidas > 0) {
      const eficiencia =
        ((pecas_produzidas * tempo_ideal) / tempo_decorrido) * 100;
      return Math.min(150, Math.max(0, eficiencia)); // Limitar a 150%
    }

    return 0;
  } catch (error) {
    console.error("Erro eficiência atual:", error);
    return 0;
  }
}

app.post("/api/dashboard-tempo-real", autenticarToken, async (req, res) => {
  try {
    // console.log("📊 Recebida requisição para dashboard tempo real");
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ error: "IDs das máquinas são obrigatórios" });
    }

    // console.log(
    //   `🔍 Buscando dados tempo real para máquinas: ${ids.join(", ")}`,
    // );

    const resultados = {};

    // Buscar dados de cada máquina em paralelo
    await Promise.all(
      ids.map(async (idMaquina) => {
        try {
          console.log(`🔄 Processando máquina ${idMaquina}...`);

          // ✅ BUSCAR TODOS OS DADOS COM FALLBACK
          const oeeData = await calcularOEETempoReal(idMaquina).catch(
            (error) => {
              console.error(`❌ Erro OEE máquina ${idMaquina}:`, error);
              return getOeeDataDefault();
            },
          );

          const statusData = await getStatusMaquina(idMaquina).catch(
            (error) => {
              console.error(`❌ Erro status máquina ${idMaquina}:`, error);
              return getStatusDataDefault();
            },
          );

          const produtoData = await getProdutoAtual(idMaquina).catch(
            (error) => {
              console.error(`❌ Erro produto máquina ${idMaquina}:`, error);
              return getProdutoDataDefault();
            },
          );

          const operadorData = await getOperadorAtual(idMaquina).catch(
            (error) => {
              console.error(`❌ Erro operador máquina ${idMaquina}:`, error);
              return getOperadorDataDefault();
            },
          );

          /*           // ✅ VERIFICAR ESTRUTURA DOS DADOS
                    console.log(`✅ Estrutura máquina ${idMaquina}:`, {
                      oee: !!oeeData,
                      status: !!statusData,
                      produto: !!produtoData,
                      operador: !!operadorData,
                      oeeValue: oeeData?.oee,
                      statusValue: statusData?.status,
                      produtoValue: produtoData?.em_producao,
                    }); */

          resultados[idMaquina] = {
            oee: oeeData,
            status: statusData,
            produto: produtoData,
            operador: operadorData,
          };

          // console.log(`✅ Máquina ${idMaquina} processada com sucesso`);
        } catch (error) {
          console.error(`❌ Erro geral na máquina ${idMaquina}:`, error);
          resultados[idMaquina] = {
            oee: getOeeDataDefault(),
            status: getStatusDataDefault(),
            produto: getProdutoDataDefault(),
            operador: getOperadorDataDefault(),
          };
        }
      }),
    );

    //  console.log("🎯 Dashboard tempo real enviado com sucesso");
    res.json(resultados);
  } catch (error) {
    console.error("❌ Erro geral no dashboard tempo real:", error);
    res.status(500).json({ error: "Erro ao buscar dados tempo real" });
  }
});

const obterDashboardTempoRealMaquina = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar apenas quantidade_pecas (leve e rápido)
    const result = await pool.query(
      `
      SELECT 
        ap.quantidade_pecas,
        ap.pecas_boas
      FROM apontamento_producao ap
      WHERE ap.id_maquina = $1 
        AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
      LIMIT 1
    `,
      [id],
    );

    const quantidade = result.rows[0]?.quantidade_pecas || 0;
    const pecasBoas = result.rows[0]?.pecas_boas ?? 0;

    res.json({
      quantidade_pecas: quantidade,
      pecas_boas: pecasBoas,
      data_atualizacao: result.rows[0]?.data_atualizacao,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Erro ao buscar quantidade:", error);
    res.status(500).json({
      quantidade_pecas: 0,
      error: "Erro ao buscar quantidade",
    });
  }
};

app.get("/dashboard-tempo-real-maquina/:id", autenticarToken, obterDashboardTempoRealMaquina);
app.get("/api/dashboard-tempo-real-maquina/:id", autenticarToken, obterDashboardTempoRealMaquina);

// ✅ ROTA DE HEALTH CHECK para testar conectividade
app.get("/api/health-check", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    message: "Servidor está funcionando",
  });
});

// ✅ FUNÇÃO AUXILIAR: Paradas por período (já existente, apenas certificar)
async function calcularParadasPeriodo(idMaquina, inicio, fim) {
  try {
    const result = await pool.query(
      `
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN (
              (id_produto IS NULL AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas = 0 AND motivo_parada_maquina IS NOT NULL)
            ) AND motivo_parada_maquina IN (
              'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
              'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
              'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
              'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima'
            ) THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_paradas_nao_programadas_segundos,

        COALESCE(SUM(
          CASE 
            WHEN (
              (id_produto IS NULL AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas = 0 AND motivo_parada_maquina IS NOT NULL)
            ) AND motivo_parada_maquina IN (
              'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva'
            ) THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_paradas_programadas_segundos

      FROM apontamento_producao 
      WHERE id_maquina = $3 
      AND (
        (data_inicio BETWEEN $1 AND $2)
        OR (data_fim BETWEEN $1 AND $2)
        OR (data_inicio < $1 AND (data_fim IS NULL OR data_fim > $1))
      )
    `,
      [inicio, fim, idMaquina],
    );

    return {
      tempo_paradas_nao_programadas_segundos:
        parseFloat(result.rows[0].tempo_paradas_nao_programadas_segundos) || 0,
      tempo_paradas_programadas_segundos:
        parseFloat(result.rows[0].tempo_paradas_programadas_segundos) || 0,
    };
  } catch (error) {
    console.error("Erro paradas período:", error);
    return {
      tempo_paradas_nao_programadas_segundos: 0,
      tempo_paradas_programadas_segundos: 0,
    };
  }
}

// ✅ FUNÇÃO AUXILIAR: Performance Tempo Real
async function calcularPerformanceTempoReal(
  idMaquina,
  inicioDia,
  agora,
  tipo_maquina,
) {
  try {
    const performanceResult = await pool.query(
      `
      SELECT 
        ap.id,
        ap.id_produto,
        ap.quantidade_pecas,
        ap.data_inicio,
        ap.data_fim,
        ap.status,
        p.ds_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND ap.id_produto IS NOT NULL
      AND (
        (ap.data_inicio BETWEEN $2 AND $3)
        OR (ap.data_fim BETWEEN $2 AND $3)
        OR (ap.data_inicio < $2 AND (ap.data_fim IS NULL OR ap.data_fim > $2))
      )
      AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
      ORDER BY ap.data_inicio DESC
    `,
      [idMaquina, inicioDia, agora],
    );

    let tempo_ideal_total_segundos = 0;
    let tempo_total_producao_segundos = 0;
    let performance_final = 0;

    if (performanceResult.rows.length > 0) {
      console.log(
        `🔍 Performance: ${performanceResult.rows.length} apontamentos encontrados`,
      );

      for (const apontamento of performanceResult.rows) {
        const inicio_apontamento = new Date(apontamento.data_inicio);
        const fim_apontamento = apontamento.data_fim
          ? new Date(apontamento.data_fim)
          : agora;

        // Calcular tempo dentro do período do dia
        const inicio_periodo = new Date(
          Math.max(inicio_apontamento.getTime(), inicioDia.getTime()),
        );
        const fim_periodo = new Date(
          Math.min(fim_apontamento.getTime(), agora.getTime()),
        );

        const tempo_apontamento_segundos = Math.max(
          0,
          (fim_periodo - inicio_periodo) / 1000,
        );

        if (tempo_apontamento_segundos > 0) {
          tempo_total_producao_segundos += tempo_apontamento_segundos;

          const pecas_apontamento = apontamento.quantidade_pecas || 0;

          // ✅ CALCULAR TEMPO IDEAL CORRETO
          const tempo_ideal = calcularTempoIdealProduto(
            apontamento,
            tipo_maquina,
          );

          if (tempo_ideal && pecas_apontamento > 0) {
            tempo_ideal_total_segundos += pecas_apontamento * tempo_ideal;
          }

          console.log(
            `📦 ${apontamento.ds_produto}: ${pecas_apontamento} peças em ${Math.round(tempo_apontamento_segundos / 60)}min (ideal: ${tempo_ideal}s/peça)`,
          );
        }
      }

      // ✅ PERFORMANCE CORRETA: (Tempo Ideal Total / Tempo Real Total) × 100
      performance_final =
        tempo_total_producao_segundos > 0
          ? (tempo_ideal_total_segundos / tempo_total_producao_segundos) * 100
          : 0;

      console.log(
        `⚡ Performance cálculo: ${tempo_ideal_total_segundos.toFixed(0)}s ideal / ${tempo_total_producao_segundos.toFixed(0)}s real = ${performance_final.toFixed(2)}%`,
      );
    } else {
      console.log(
        `⚠️ Sem apontamentos de performance para máquina ${idMaquina}`,
      );
      performance_final = 0;
    }

    return Math.min(150, Math.max(0, performance_final)); // Limitar a 150% máximo
  } catch (error) {
    console.error("Erro performance tempo real:", error);
    return 80; // Fallback
  }
}

// ✅ FUNÇÃO AUXILIAR: Paradas por período
async function calcularParadasPeriodo(idMaquina, inicio, fim) {
  try {
    const result = await pool.query(
      `
      SELECT 
        COALESCE(SUM(
          CASE 
            WHEN (
              (id_produto IS NULL AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas = 0 AND motivo_parada_maquina IS NOT NULL)
            ) AND motivo_parada_maquina IN (
              'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
              'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
              'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
              'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima'
            ) THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_paradas_nao_programadas_segundos,

        COALESCE(SUM(
          CASE 
            WHEN (
              (id_produto IS NULL AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas = 0 AND motivo_parada_maquina IS NOT NULL)
            ) AND motivo_parada_maquina IN (
              'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva'
            ) THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_paradas_programadas_segundos

      FROM apontamento_producao 
      WHERE id_maquina = $3 
      AND (
        (data_inicio BETWEEN $1 AND $2)
        OR (data_fim BETWEEN $1 AND $2)
        OR (data_inicio < $1 AND (data_fim IS NULL OR data_fim > $1))
      )
    `,
      [inicio, fim, idMaquina],
    );

    return {
      tempo_paradas_nao_programadas_segundos:
        parseFloat(result.rows[0].tempo_paradas_nao_programadas_segundos) || 0,
      tempo_paradas_programadas_segundos:
        parseFloat(result.rows[0].tempo_paradas_programadas_segundos) || 0,
    };
  } catch (error) {
    console.error("Erro paradas período:", error);
    return {
      tempo_paradas_nao_programadas_segundos: 0,
      tempo_paradas_programadas_segundos: 0,
    };
  }
}

// FUNÇÃO CALCULAR OEE
async function calcularOEE(idMaquina) {
  try {
    const agora = new Date();

    console.log(`🔍 INICIANDO CÁLCULO OEE - Máquina ${idMaquina}`);

    // Período CORRETO 00:00 até 23:59
    const inicioDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      0,
      0,
      0,
    );
    const fimDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      23,
      59,
      59,
    );

    console.log(
      `📅 Período: ${inicioDia.toLocaleString("pt-BR")} até ${fimDia.toLocaleString("pt-BR")}`,
    );

    // 1. Buscar informações da máquina
    const maquinaResult = await pool.query(
      `
      SELECT tipo_maquina, descricao 
      FROM maquinas 
      WHERE id = $1
    `,
      [idMaquina],
    );

    if (maquinaResult.rows.length === 0) {
      return getOeeDataDefault();
    }

    const { tipo_maquina, descricao } = maquinaResult.rows[0];
    console.log(`🏭 Máquina: ${descricao} (${tipo_maquina})`);

    // 2. IDENTIFICAR PRODUÇÃO VS PARADAS - REGRAS COMPLETAS
    const analiseResult = await pool.query(
      `
      SELECT 
        -- ✅ PRODUÇÃO REAL: Tem apontamento de produto E quantidade
        COALESCE(SUM(
          CASE 
            WHEN (id_produto IS NOT NULL AND quantidade_pecas > 0) 
                 OR (id_produto IS NOT NULL AND quantidade_pecas IS NULL AND status = 'EM_ANDAMENTO') THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_produtivo_segundos,

        -- ✅ PARADAS NÃO PROGRAMADAS: Motivos específicos
        COALESCE(SUM(
          CASE 
            WHEN (
              (id_produto IS NULL AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas = 0 AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas IS NULL AND motivo_parada_maquina IS NOT NULL)
            ) AND motivo_parada_maquina IN (
              'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
              'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
              'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
              'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima',
              'MANUTENÇÃO DO MOLDE', 'Problema de refrigeração', 'Troca matéria prima (cor)',
              'Troca ribbon'
            ) THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_paradas_nao_programadas_segundos,

        -- ✅ PARADAS PROGRAMADAS: Motivos programados
        COALESCE(SUM(
          CASE 
            WHEN (
              (id_produto IS NULL AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas = 0 AND motivo_parada_maquina IS NOT NULL)
              OR (quantidade_pecas IS NULL AND motivo_parada_maquina IS NOT NULL)
            ) AND motivo_parada_maquina IN (
              'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva', 
              'Intervalo para Café', 'Parada planejada'
            ) THEN 
              EXTRACT(EPOCH FROM (
                LEAST(COALESCE(data_fim, $2), $2) - 
                GREATEST(data_inicio, $1)
              ))
            ELSE 0 
          END
        ), 0) as tempo_paradas_programadas_segundos,

        -- Tempo total do período
        EXTRACT(EPOCH FROM ($2 - $1)) as tempo_total_segundos,

        -- Contagem para debug
        COUNT(*) as total_apontamentos,
        COUNT(CASE WHEN id_produto IS NOT NULL AND quantidade_pecas > 0 THEN 1 END) as producoes_com_quantidade,
        COUNT(CASE WHEN id_produto IS NOT NULL AND quantidade_pecas IS NULL THEN 1 END) as producoes_sem_quantidade,
        COUNT(CASE WHEN id_produto IS NULL AND motivo_parada_maquina IS NOT NULL THEN 1 END) as paradas_explicitas

      FROM apontamento_producao 
      WHERE id_maquina = $3 
      AND (
        (data_inicio BETWEEN $1 AND $2)
        OR (data_fim BETWEEN $1 AND $2)
        OR (data_inicio < $1 AND (data_fim IS NULL OR data_fim > $1))
        OR (data_inicio >= $1 AND data_fim IS NULL)
      )
    `,
      [inicioDia, fimDia, idMaquina],
    );

    const {
      tempo_produtivo_segundos,
      tempo_paradas_nao_programadas_segundos,
      tempo_paradas_programadas_segundos,
      tempo_total_segundos,
      total_apontamentos,
      producoes_com_quantidade,
      producoes_sem_quantidade,
      paradas_explicitas,
    } = analiseResult.rows[0];

    console.log(`📊 Análise apontamentos:`, {
      total: total_apontamentos,
      producoes_com_quantidade: producoes_com_quantidade,
      producoes_sem_quantidade: producoes_sem_quantidade,
      paradas_explicitas: paradas_explicitas,
    });

    console.log(`⏱️ Tempos REAIS:`, {
      produtivo: `${Math.round(tempo_produtivo_segundos / 60)}min`,
      paradas_nao_programadas: `${Math.round(tempo_paradas_nao_programadas_segundos / 60)}min`,
      paradas_programadas: `${Math.round(tempo_paradas_programadas_segundos / 60)}min`,
      total_periodo: `${Math.round(tempo_total_segundos / 60)}min`,
    });

    // ✅ FÓRMULA OEE CORRETA:
    // Disponibilidade = (Tempo Produtivo / Tempo Operacional Planejado) × 100
    // Tempo Operacional Planejado = Tempo Total - Paradas Programadas

    const tempo_operacional_planejado_segundos = Math.max(
      0,
      tempo_total_segundos - tempo_paradas_programadas_segundos,
    );

    let disponibilidade = 0;
    if (tempo_operacional_planejado_segundos > 0) {
      disponibilidade =
        (tempo_produtivo_segundos / tempo_operacional_planejado_segundos) * 100;
    }

    disponibilidade = Math.min(100, Math.max(0, disponibilidade));
    console.log(`📊 Disponibilidade: ${disponibilidade.toFixed(2)}%`);

    // 3. PERFORMANCE - Buscar dados de produção REAL
    let performance = 0;
    let pecas_produzidas = 0;
    let tempo_ideal_total_segundos = 0;
    let tempo_total_producao_segundos = 0;

    const performanceResult = await pool.query(
      `
      SELECT 
        ap.id,
        ap.id_produto,
        ap.quantidade_pecas,
        ap.data_inicio,
        ap.data_fim,
        ap.status,
        p.ds_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao,
        p.pecas_por_ciclo
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND (
        -- ✅ PRODUÇÃO REAL: Tem produto E (tem quantidade OU está em andamento)
        (ap.id_produto IS NOT NULL AND (ap.quantidade_pecas > 0 OR ap.status = 'EM_ANDAMENTO'))
      )
      AND (
        (ap.data_inicio BETWEEN $2 AND $3)
        OR (ap.data_fim BETWEEN $2 AND $3)
        OR (ap.data_inicio < $2 AND (ap.data_fim IS NULL OR ap.data_fim > $2))
      )
      AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
      ORDER BY ap.data_inicio DESC
    `,
      [idMaquina, inicioDia, fimDia],
    );

    console.log(
      `🔍 Performance: ${performanceResult.rows.length} apontamentos de PRODUÇÃO`,
    );

    if (performanceResult.rows.length > 0) {
      for (const apontamento of performanceResult.rows) {
        const inicio_apontamento = new Date(apontamento.data_inicio);
        const fim_apontamento = apontamento.data_fim
          ? new Date(apontamento.data_fim)
          : agora;

        // Calcular tempo dentro do período do dia
        const inicio_periodo = new Date(
          Math.max(inicio_apontamento.getTime(), inicioDia.getTime()),
        );
        const fim_periodo = new Date(
          Math.min(fim_apontamento.getTime(), fimDia.getTime()),
        );

        const tempo_apontamento_segundos = Math.max(
          0,
          (fim_periodo - inicio_periodo) / 1000,
        );

        if (tempo_apontamento_segundos > 0) {
          tempo_total_producao_segundos += tempo_apontamento_segundos;

          const pecas_apontamento = apontamento.quantidade_pecas || 0;
          pecas_produzidas += pecas_apontamento;

          // Calcular tempo ideal
          const tempo_ideal = calcularTempoIdealProduto(
            apontamento,
            tipo_maquina,
          );
          if (tempo_ideal && pecas_apontamento > 0) {
            tempo_ideal_total_segundos += pecas_apontamento * tempo_ideal;
          }

          console.log(
            `📦 ${apontamento.ds_produto || "Produto não identificado"}: ${pecas_apontamento} peças em ${Math.round(tempo_apontamento_segundos / 60)}min`,
          );
        }
      }

      // Performance = (Tempo Ideal Total / Tempo Real Total) × 100
      performance =
        tempo_total_producao_segundos > 0
          ? (tempo_ideal_total_segundos / tempo_total_producao_segundos) * 100
          : 0;
    } else {
      console.log(`⚠️ Sem produção identificada hoje`);
      performance = 0;
    }

    performance = Math.min(100, Math.max(0, performance));
    console.log(`⚡ Performance: ${performance.toFixed(2)}%`);

    // 4. QUALIDADE - Apenas produções finalizadas com quantidade
    const qualidadeResult = await pool.query(
      `
            SELECT 
        COALESCE(SUM(pecas_boas), COALESCE(SUM(quantidade_pecas), 0)) as pecas_boas,
        COALESCE(SUM(quantidade_pecas), 0) as pecas_totais,
        COALESCE(SUM(refugo_kg), 0) as refugo_total
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND data_inicio >= $2
      AND data_inicio <= $3
      AND status IN ('FINALIZADO', 'EM_ANDAMENTO')
      AND id_produto IS NOT NULL  -- ✅ Apenas produções
      AND quantidade_pecas > 0    -- ✅ Com quantidade apontada


    `,
      [idMaquina, inicioDia, fimDia],
    );

    const { pecas_boas, pecas_totais, refugo_total } = qualidadeResult.rows[0];

    let qualidade = 100;
    const total_pecas = Math.max(pecas_totais, pecas_produzidas);

    if (total_pecas > 0) {
      if (pecas_boas > 0) {
        qualidade = (pecas_boas / total_pecas) * 100;
      } else {
        // ✅ Para apontamentos EM_ANDAMENTO, usar quantidade_pecas como base
        // e estimar pecas_boas como 98% das peças produzidas
        const pecas_boas_estimadas = Math.round(total_pecas * 0.98);
        qualidade = (pecas_boas_estimadas / total_pecas) * 100;
      }
    }

    qualidade = Math.min(100, Math.max(0, qualidade));
    console.log(`✅ Qualidade: ${qualidade.toFixed(2)}%`);

    // 5. OEE TOTAL
    const oee = (disponibilidade * performance * qualidade) / 10000;

    console.log(
      `🎯 OEE FINAL: ${disponibilidade.toFixed(2)}% × ${performance.toFixed(2)}% × ${qualidade.toFixed(2)}% = ${oee.toFixed(2)}%`,
    );

    return {
      disponibilidade: disponibilidade,
      performance: performance,
      qualidade: qualidade,
      oee: oee,
      metricas: {
        tempo_produtivo_minutos: Math.round(tempo_produtivo_segundos / 60),
        tempo_paradas_nao_programadas_minutos: Math.round(
          tempo_paradas_nao_programadas_segundos / 60,
        ),
        tempo_paradas_programadas_minutos: Math.round(
          tempo_paradas_programadas_segundos / 60,
        ),
        tempo_total_minutos: Math.round(tempo_total_segundos / 60),
        pecas_produzidas: pecas_produzidas,
        pecas_boas:
          pecas_boas > 0 ? pecas_boas : Math.round(pecas_produzidas * 0.98),
        refugo_total: refugo_total || 0,
        tempo_ideal_minutos: Math.round(tempo_ideal_total_segundos / 60),
        tempo_real_minutos: Math.round(tempo_total_producao_segundos / 60),
        eficiencia_calculada: performance,
      },
      tipo_maquina: tipo_maquina,
    };
  } catch (error) {
    console.error("❌ Erro ao calcular OEE:", error);
    return getOeeDataDefault();
  }
}

// ✅ NOVA FUNÇÃO: calcularParadasDoDiaComPeriodo
async function calcularParadasDoDiaComPeriodo(idMaquina, inicioDia, fimDia) {
  try {
    console.log(
      `📅 Calculando paradas: ${inicioDia.toLocaleString("pt-BR")} até ${fimDia.toLocaleString("pt-BR")}`,
    );

    const result = await pool.query(
      `
      WITH paradas_do_dia AS (
        SELECT 
          pp.id,
          pp.id_apontamento,
          pp.motivo_parada,
          pp.data_inicio,
          pp.data_fim,
          -- Considerar apenas a parte da parada que está dentro do dia
          CASE 
            WHEN pp.data_inicio < $1 THEN $1  -- Parada começou antes do dia
            ELSE pp.data_inicio 
          END as inicio_calculado,
          
          CASE 
            WHEN pp.data_fim IS NULL THEN $2  -- Parada ainda em andamento
            WHEN pp.data_fim > $2 THEN $2     -- Parada terminou depois do dia
            ELSE pp.data_fim 
          END as fim_calculado
          
        FROM paradas_producao pp
        INNER JOIN apontamento_producao ap ON pp.id_apontamento = ap.id
        WHERE ap.id_maquina = $3
          AND (
            -- Paradas que estavam ativas em algum momento do dia
            (pp.data_inicio <= $2 AND (pp.data_fim IS NULL OR pp.data_fim >= $1))
          )
      )
      SELECT 
        COUNT(*) as total_paradas,
        SUM(EXTRACT(EPOCH FROM (fim_calculado - inicio_calculado))) as tempo_total_paradas_segundos,
        SUM(
          CASE 
            -- PARADAS NÃO PROGRAMADAS (consomem disponibilidade)
            WHEN motivo_parada IN (
              'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
              'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
              'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
              'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima',
              'MANUTENÇÃO DO MOLDE', 'Problema de refrigeração', 'Troca matéria prima (cor)',
              'Troca ribbon'
            ) THEN EXTRACT(EPOCH FROM (fim_calculado - inicio_calculado))
            ELSE 0 
          END
        ) as tempo_paradas_nao_programadas_segundos,
        SUM(
          CASE 
            -- PARADAS PROGRAMADAS (NÃO consomem disponibilidade)
            WHEN motivo_parada IN (
              'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva', 
              'Intervalo para Café', 'Parada planejada'
            ) THEN EXTRACT(EPOCH FROM (fim_calculado - inicio_calculado))
            ELSE 0 
          END
        ) as tempo_paradas_programadas_segundos,
        -- Contagens por tipo
        COUNT(
          CASE WHEN motivo_parada IN (
            'Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva', 
            'Intervalo para Café', 'Parada planejada'
          ) THEN 1 END
        ) as total_paradas_programadas,
        COUNT(
          CASE WHEN motivo_parada IN (
            'Manutenção - Máquina', 'Aguardando definição da qualidade', 'Troca de Bobina',
            'Problema no ar', 'Falta de produto', 'Aguardando Reabastecimento',
            'Espera - Manutenção Máquina', 'Espera - Manutenção Molde', 'Setup',
            'Falta de colaborador', 'Falta de energia', 'Falta de matéria prima',
            'MANUTENÇÃO DO MOLDE', 'Problema de refrigeração', 'Troca matéria prima (cor)',
            'Troca ribbon'
          ) THEN 1 END
        ) as total_paradas_nao_programadas
      FROM paradas_do_dia
    `,
      [inicioDia, fimDia, idMaquina],
    );

    const dados = result.rows[0];

    return {
      total_paradas: parseInt(dados.total_paradas) || 0,
      tempo_total_paradas_segundos:
        parseFloat(dados.tempo_total_paradas_segundos) || 0,
      tempo_paradas_nao_programadas_segundos:
        parseFloat(dados.tempo_paradas_nao_programadas_segundos) || 0,
      tempo_paradas_programadas_segundos:
        parseFloat(dados.tempo_paradas_programadas_segundos) || 0,
      total_paradas_nao_programadas:
        parseInt(dados.total_paradas_nao_programadas) || 0,
      total_paradas_programadas: parseInt(dados.total_paradas_programadas) || 0,
    };
  } catch (error) {
    console.error("❌ Erro ao calcular paradas do dia:", error);
    return {
      total_paradas: 0,
      tempo_total_paradas_segundos: 0,
      tempo_paradas_nao_programadas_segundos: 0,
      tempo_paradas_programadas_segundos: 0,
      total_paradas_nao_programadas: 0,
      total_paradas_programadas: 0,
    };
  }
}

// Função auxiliar para dados padrão do OEE
function getOeeDataDefault() {
  return {
    disponibilidade: 0,
    performance: 0,
    qualidade: 100,
    oee: 0,
    metricas: {
      tempo_produtivo_minutos: 0,
      tempo_parado_minutos: 0,
      tempo_paradas_programadas_minutos: 0, // ✅ CAMPO ADICIONADO
      tempo_total_minutos: 0,
      pecas_produzidas: 0,
      pecas_boas: 0,
      refugo_total: 0,
      tempo_ideal_minutos: 0,
      tempo_real_minutos: 0,
      eficiencia_calculada: 0,
      total_paradas: 0,
      total_paradas_nao_programadas: 0,
      total_paradas_programadas: 0,
      tempo_paradas_nao_programadas_minutos: 0,
      tempo_paradas_programadas_minutos: 0,
    },
    tipo_maquina: "DESCONHECIDO",
  };
}

// Função auxiliar para calcular tempo ideal baseado no produto e tipo de máquina
function calcularTempoIdealProduto(apontamento, tipoMaquina) {
  if (!apontamento.id_produto) return null;

  const produto = apontamento;

  switch (tipoMaquina) {
    case "MONTAGEM":
      if (produto.tempo_padrao_montagem_segundos) {
        return produto.tempo_padrao_montagem_segundos;
      } else if (produto.meta_horaria_montagem) {
        // Converter meta horária para tempo por peça (segundos/peça)
        return 3600 / produto.meta_horaria_montagem;
      }
      break;

    case "EMBALAGEM":
      if (produto.tempo_padrao_embalagem_segundos) {
        return produto.tempo_padrao_embalagem_segundos;
      } else if (produto.meta_horaria_embalagem) {
        return 3600 / produto.meta_horaria_embalagem;
      }
      break;

    case "INJETORA":
      if (produto.tempo_padrao_injecao_segundos) {
        return produto.tempo_padrao_injecao_segundos;
      } else if (produto.meta_horaria_injecao) {
        return 3600 / produto.meta_horaria_injecao;
      }
      break;
  }

  // Valores padrão caso não tenha cadastro (ajuste conforme sua realidade)
  console.warn(
    `Tempo padrão não cadastrado para produto ${apontamento.id_produto} na máquina ${tipoMaquina}`,
  );

  switch (tipoMaquina) {
    case "MONTAGEM":
      return 30; // 30 segundos por peça padrão para montagem
    case "EMBALAGEM":
      return 15; // 15 segundos por peça padrão para embalagem
    case "INJETORA":
      return 45; // 45 segundos por peça padrão para injeção
    default:
      return 60; // 60 segundos padrão
  }
}

// ✅ ROTA ESPECÍFICA PARA DASHBOARD TEMPO REAL
app.get(
  "/api/oee-tempo-real/:id_maquina",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_maquina } = req.params;
      const oeeData = await calcularOEETempoReal(parseInt(id_maquina));
      res.json(oeeData);
    } catch (error) {
      console.error("Erro na rota OEE tempo real:", error);
      res.status(500).json({ error: "Erro ao calcular OEE tempo real" });
    }
  },
);

// ✅ ROTA PARA MÚLTIPLAS MÁQUINAS TEMPO REAL
app.post("/api/dashboard-tempo-real", autenticarToken, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ error: "IDs das máquinas são obrigatórios" });
    }

    const resultados = {};

    // Buscar dados de cada máquina em paralelo
    await Promise.all(
      ids.map(async (idMaquina) => {
        try {
          resultados[idMaquina] = await calcularOEETempoReal(idMaquina);
        } catch (error) {
          console.error(`Erro máquina ${idMaquina}:`, error);
          resultados[idMaquina] = getOeeDataDefault();
        }
      }),
    );

    res.json(resultados);
  } catch (error) {
    console.error("Erro dashboard tempo real:", error);
    res.status(500).json({ error: "Erro ao buscar dados tempo real" });
  }
});
// OEE por Operador
app.get("/api/oee-por-operador", autenticarToken, async (req, res) => {
  try {
    const { dias = "7" } = req.query;
    const diasInt = parseInt(dias);

    // VALIDAÇÃO para evitar NaN
    const diasValidados = isNaN(diasInt) || diasInt <= 0 ? 7 : diasInt;

    console.log(
      `📊 Buscando OEE por operador (agrupado) - últimos ${diasValidados} dias`,
    );

    const result = await pool.query(`
      SELECT 
        o.id as operador_id,
        o.nome as operador_nome,
        pe.quantidade,
        o.turno,
        
        -- Contagem de máquinas diferentes que o operador trabalhou
        COUNT(DISTINCT m.id) as total_maquinas,
        STRING_AGG(DISTINCT m.descricao, ', ') as maquinas_trabalhadas,
        
      INNER JOIN produtos_cache pc ON pe.id_produto = pc.id
      WHERE pc.id = $1
        ROUND(
          (SUM(
            CASE 
              WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
                EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              ELSE 0 
            END
          ) / 
          NULLIF(SUM(
            CASE 
              WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO', 'PAUSADO', 'MAQUINA_PARADA') THEN 
                EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              ELSE 0 
            END
          ), 0)) * 100, 2
        ) as disponibilidade,
        
        -- PERFORMANCE (média ponderada por tempo)
        ROUND(
          SUM(
            CASE 
              WHEN m.tipo_maquina = 'MONTAGEM' AND p.tempo_padrao_montagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
                LEAST((
                  (ap.quantidade_pecas * p.tempo_padrao_montagem_segundos) / 
                  NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
                ) * 100, 150) * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              WHEN m.tipo_maquina = 'EMBALAGEM' AND p.tempo_padrao_embalagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
                LEAST((
                  (ap.quantidade_pecas * p.tempo_padrao_embalagem_segundos) / 
                  NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
                ) * 100, 150) * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              WHEN m.tipo_maquina = 'INJETORA' AND p.tempo_padrao_injecao_segundos > 0 AND ap.quantidade_pecas > 0 THEN
                LEAST((
                  (ap.quantidade_pecas * p.tempo_padrao_injecao_segundos) / 
                  NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
                ) * 100, 150) * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              ELSE 80 * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            END
          ) / 
          NULLIF(SUM(
            CASE 
              WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
                EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              ELSE 0 
            END
          ), 0), 2
        ) as performance,
        
        -- QUALIDADE (geral do operador)
        ROUND(
          CASE 
            WHEN SUM(ap.quantidade_pecas) > 0 THEN
              COALESCE(
                (SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) / SUM(ap.quantidade_pecas)) * 100,
                98
              )
            ELSE 100
          END, 2
        ) as qualidade,
        
        -- DADOS DE PRODUÇÃO (totais do operador)
        SUM(ap.quantidade_pecas) as pecas_produzidas,
        SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) as pecas_boas_estimadas,
        ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)) / 60), 2) as tempo_total_minutos,
        COUNT(ap.id) as total_apontamentos,
        ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)) / 3600), 2) as horas_totais_producao

      FROM apontamento_producao ap
      INNER JOIN operadores o ON ap.id_operador = o.id
      INNER JOIN maquinas m ON ap.id_maquina = m.id
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.data_inicio >= CURRENT_DATE - INTERVAL '${diasValidados} days'
        AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
        AND o.tipo_operador NOT IN ('Gestão', 'Desligado')
      GROUP BY o.id, o.nome, o.tipo_operador, o.turno
      HAVING SUM(ap.quantidade_pecas) > 0
      ORDER BY 
        (SUM(
          CASE 
            WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
              EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            ELSE 0 
          END
        ) / 
        NULLIF(SUM(
          CASE 
            WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO', 'PAUSADO', 'MAQUINA_PARADA') THEN 
              EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            ELSE 0 
          END
        ), 0)) *
        (SUM(
          CASE 
            WHEN m.tipo_maquina = 'MONTAGEM' AND p.tempo_padrao_montagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              LEAST((
                (ap.quantidade_pecas * p.tempo_padrao_montagem_segundos) / 
                NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
              ) * 100, 150) * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            WHEN m.tipo_maquina = 'EMBALAGEM' AND p.tempo_padrao_embalagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              LEAST((
                (ap.quantidade_pecas * p.tempo_padrao_embalagem_segundos) / 
                NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
              ) * 100, 150) * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            WHEN m.tipo_maquina = 'INJETORA' AND p.tempo_padrao_injecao_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              LEAST((
                (ap.quantidade_pecas * p.tempo_padrao_injecao_segundos) / 
                NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
              ) * 100, 150) * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            ELSE 80 * EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
          END
        ) / 
        NULLIF(SUM(
          CASE 
            WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
              EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            ELSE 0 
          END
        ), 0)) *
        CASE 
          WHEN SUM(ap.quantidade_pecas) > 0 THEN
            COALESCE(
              (SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) / SUM(ap.quantidade_pecas)) * 100,
              98
            )
          ELSE 100
        END / 10000 DESC
    `);

    console.log(`✅ Encontrados ${result.rows.length} operadores com produção`);

    // Calcular OEE total para cada operador
    const dadosComOee = result.rows.map((row) => ({
      ...row,
      oee_total: Number(
        (
          (row.disponibilidade * row.performance * row.qualidade) /
          10000
        ).toFixed(2),
      ),
    }));

    res.json(dadosComOee);
  } catch (error) {
    console.error("❌ Erro ao buscar OEE por operador:", error);
    res.status(500).json({
      error: "Erro ao buscar dados dos operadores",
      details: error.message,
    });
  }
});

// OEE por Máquina - DADOS REAIS (CORRIGIDO)
app.get("/api/oee-por-maquina", autenticarToken, async (req, res) => {
  try {
    const { dias = "7" } = req.query;
    const diasInt = parseInt(dias);

    // VALIDAÇÃO para evitar NaN
    const diasValidados = isNaN(diasInt) || diasInt <= 0 ? 7 : diasInt;

    console.log(`🏭 Buscando OEE por máquina - últimos ${diasValidados} dias`);

    const result = await pool.query(`
      SELECT 
        m.id as maquina_id,
        m.descricao as maquina_descricao,
        m.tipo_maquina,
        
        -- DISPONIBILIDADE
        ROUND(
          (SUM(
            CASE 
              WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
                EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              ELSE 0 
            END
          ) / 
          NULLIF(SUM(
            CASE 
              WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO', 'PAUSADO', 'MAQUINA_PARADA') THEN 
                EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
              ELSE 0 
            END
          ), 0)) * 100, 2
        ) as disponibilidade,
        
        -- PERFORMANCE
        ROUND(
          AVG(
            CASE 
              WHEN m.tipo_maquina = 'MONTAGEM' AND p.tempo_padrao_montagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
                LEAST((
                  (ap.quantidade_pecas * p.tempo_padrao_montagem_segundos) / 
                  NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
                ) * 100, 150)
              WHEN m.tipo_maquina = 'EMBALAGEM' AND p.tempo_padrao_embalagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
                LEAST((
                  (ap.quantidade_pecas * p.tempo_padrao_embalagem_segundos) / 
                  NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
                ) * 100, 150)
              WHEN m.tipo_maquina = 'INJETORA' AND p.tempo_padrao_injecao_segundos > 0 AND ap.quantidade_pecas > 0 THEN
                LEAST((
                  (ap.quantidade_pecas * p.tempo_padrao_injecao_segundos) / 
                  NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
                ) * 100, 150)
              ELSE 80
            END
          ), 2
        ) as performance,
        
        -- QUALIDADE
        ROUND(
          CASE 
            WHEN SUM(ap.quantidade_pecas) > 0 THEN
              COALESCE(
                (SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) / SUM(ap.quantidade_pecas)) * 100,
                98
              )
            ELSE 100
          END, 2
        ) as qualidade,
        
        -- MÉTRICAS
        SUM(ap.quantidade_pecas) as total_pecas_produzidas,
        COUNT(ap.id) as total_apontamentos,
        ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)) / 3600), 2) as horas_totais_producao

      FROM apontamento_producao ap
      INNER JOIN maquinas m ON ap.id_maquina = m.id
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.data_inicio >= CURRENT_DATE - INTERVAL '${diasValidados} days'
        AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
      GROUP BY m.id, m.descricao, m.tipo_maquina
      HAVING SUM(ap.quantidade_pecas) > 0
      ORDER BY 
        (SUM(
          CASE 
            WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
              EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            ELSE 0 
          END
        ) / 
        NULLIF(SUM(
          CASE 
            WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO', 'PAUSADO', 'MAQUINA_PARADA') THEN 
              EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio))
            ELSE 0 
          END
        ), 0)) *
        AVG(
          CASE 
            WHEN m.tipo_maquina = 'MONTAGEM' AND p.tempo_padrao_montagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              LEAST((
                (ap.quantidade_pecas * p.tempo_padrao_montagem_segundos) / 
                NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
              ) * 100, 150)
            WHEN m.tipo_maquina = 'EMBALAGEM' AND p.tempo_padrao_embalagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              LEAST((
                (ap.quantidade_pecas * p.tempo_padrao_embalagem_segundos) / 
                NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
              ) * 100, 150)
            WHEN m.tipo_maquina = 'INJETORA' AND p.tempo_padrao_injecao_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              LEAST((
                (ap.quantidade_pecas * p.tempo_padrao_injecao_segundos) / 
                NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
              ) * 100, 150)
            ELSE 80
          END
        ) *
        CASE 
          WHEN SUM(ap.quantidade_pecas) > 0 THEN
            COALESCE(
              (SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) / SUM(ap.quantidade_pecas)) * 100,
              98
            )
          ELSE 100
        END / 10000 DESC
    `);

    console.log(`✅ Encontradas ${result.rows.length} máquinas com produção`);

    // Calcular OEE total para cada máquina
    const dadosComOee = result.rows.map((row) => ({
      ...row,
      oee_total: Number(
        (
          (row.disponibilidade * row.performance * row.qualidade) /
          10000
        ).toFixed(2),
      ),
    }));

    res.json(dadosComOee);
  } catch (error) {
    console.error("❌ Erro ao buscar OEE por máquina:", error);
    res.status(500).json({
      error: "Erro ao buscar dados das máquinas",
      details: error.message,
    });
  }
});

// OEE Detalhado por Máquina
app.get("/api/oee-por-maquina/:id", autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar dados da máquina
    const maquinaResult = await pool.query(
      `
      SELECT id, descricao, tipo_maquina 
      FROM maquinas 
      WHERE id = $1
    `,
      [id],
    );

    if (maquinaResult.rows.length === 0) {
      return res.status(404).json({ error: "Máquina não encontrada" });
    }

    // Calcular OEE para diferentes períodos
    const [oeeDiario, oeeSemanal, oeeMensal, historico] = await Promise.all([
      calcularOEE(id, "diario"),
      calcularOEE(id, "semanal"),
      calcularOEE(id, "mensal"),
      buscarHistoricoOee(id, 7),
    ]);

    res.json({
      maquina_id: parseInt(id),
      maquina_descricao: maquinaResult.rows[0].descricao,
      tipo_maquina: maquinaResult.rows[0].tipo_maquina,
      oee_diario: oeeDiario.oee,
      oee_semanal: oeeSemanal.oee,
      oee_mensal: oeeMensal.oee,
      disponibilidade_media: oeeDiario.disponibilidade,
      performance_media: oeeDiario.performance,
      qualidade_media: oeeDiario.qualidade,
      tempo_total_producao: oeeDiario.metricas.tempo_produtivo_minutos,
      tempo_total_paradas: oeeDiario.metricas.tempo_parado_minutos,
      eficiencia_media: oeeDiario.metricas.eficiencia_calculada,
      historico: historico,
    });
  } catch (error) {
    console.error("Erro ao buscar OEE por máquina:", error);
    res.status(500).json({ error: "Erro ao buscar dados" });
  }
});

// Função auxiliar para histórico
async function buscarHistoricoOee(maquinaId, dias) {
  const result = await pool.query(
    `
    SELECT 
      DATE(data_inicio) as data,
      AVG(
        CASE 
          WHEN status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 100 
          ELSE 0 
        END
      ) as disponibilidade,
      AVG(
        CASE 
          WHEN quantidade_pecas > 0 THEN 85 
          ELSE 0 
        END
      ) as performance,
      AVG(
        CASE 
          WHEN pecas_boas > 0 THEN (pecas_boas / quantidade_pecas) * 100
          ELSE 95 
        END
      ) as qualidade
    FROM apontamento_producao 
    WHERE id_maquina = $1 
    AND data_inicio >= CURRENT_DATE - $2
    GROUP BY DATE(data_inicio)
    ORDER BY data DESC
    LIMIT $2
  `,
    [maquinaId, dias],
  );

  return result.rows.map((row) => ({
    data: row.data,
    disponibilidade: row.disponibilidade || 0,
    performance: row.performance || 0,
    qualidade: row.qualidade || 100,
    oee:
      ((row.disponibilidade || 0) *
        (row.performance || 0) *
        (row.qualidade || 100)) /
      10000,
  }));
}

// Rota para obter OEE em tempo real
app.get("/api/oee/:id_maquina", autenticarToken, async (req, res) => {
  try {
    const { id_maquina } = req.params;
    const oeeData = await calcularOEE(parseInt(id_maquina));
    res.json(oeeData);
  } catch (error) {
    console.error("Erro na rota OEE:", error);
    res.status(500).json({ error: "Erro ao calcular OEE" });
  }
});

// Rota para status da máquina em tempo real
app.get(
  "/api/maquina-status/:id_maquina",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_maquina } = req.params;

      const statusResult = await pool.query(
        `
      SELECT status, data_inicio, motivo_parada_maquina
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND (status IN ('EM_ANDAMENTO', 'PAUSADO', 'MAQUINA_PARADA') 
           OR (status = 'FINALIZADO' AND data_fim > NOW() - INTERVAL '5 minutes'))
      ORDER BY data_inicio DESC 
      LIMIT 1
    `,
        [id_maquina],
      );

      const status = statusResult.rows[0]
        ? statusResult.rows[0].status
        : "PARADA";
      const motivo = statusResult.rows[0]
        ? statusResult.rows[0].motivo_parada_maquina
        : "";

      // Buscar pulsos recentes para animação
      const pulsosResult = await pool.query(
        `
      SELECT COUNT(*) as pulsos_recentes
      FROM apontamento_pulsos 
      WHERE id_maquina = $1 
      AND timestamp > NOW() - INTERVAL '1 minute'
    `,
        [id_maquina],
      );

      const pulsosRecentes = parseInt(pulsosResult.rows[0].pulsos_recentes);

      res.json({
        status,
        motivo,
        pulsosRecentes,
        ultimaAtualizacao: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Erro ao buscar status da máquina:", error);
      res.status(500).json({ error: "Erro ao buscar status" });
    }
  },
);

// Função auxiliar para calcular tempo ideal baseado no produto e tipo de máquina
function calcularTempoIdealProduto(apontamento, tipoMaquina) {
  if (!apontamento.id_produto) return null;

  const produto = apontamento;

  switch (tipoMaquina) {
    case "MONTAGEM":
      if (produto.tempo_padrao_montagem_segundos) {
        return produto.tempo_padrao_montagem_segundos;
      } else if (produto.meta_horaria_montagem) {
        // Converter meta horária para tempo por peça (segundos/peça)
        return 3600 / produto.meta_horaria_montagem;
      }
      break;

    case "EMBALAGEM":
      if (produto.tempo_padrao_embalagem_segundos) {
        return produto.tempo_padrao_embalagem_segundos;
      } else if (produto.meta_horaria_embalagem) {
        return 3600 / produto.meta_horaria_embalagem;
      }
      break;

    case "INJETORA":
      if (produto.tempo_padrao_injecao_segundos) {
        return produto.tempo_padrao_injecao_segundos;
      } else if (produto.meta_horaria_injecao) {
        return 3600 / produto.meta_horaria_injecao;
      }
      break;
  }

  // Valores padrão caso não tenha cadastro
  console.warn(
    `Tempo padrão não cadastrado para produto ${apontamento.id_produto} na máquina ${tipoMaquina}`,
  );

  switch (tipoMaquina) {
    case "MONTAGEM":
      return 30; // 30 segundos por peça padrão para montagem
    case "EMBALAGEM":
      return 15; // 15 segundos por peça padrão para embalagem
    case "INJETORA":
      return 45; // 45 segundos por peça padrão para injeção
    default:
      return 60; // 60 segundos padrão
  }
}

// Rota para obter detalhes do produto atual em produção
app.get(
  "/api/maquina-produto-atual/:id_maquina",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_maquina } = req.params;

      const result = await pool.query(
        `
      SELECT 
        ap.id_produto,
        p.ds_produto,
        p.referencia_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao,
        p.pecas_por_ciclo,
        ap.quantidade_pecas,
        ap.data_inicio
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND ap.status = 'EM_ANDAMENTO'
      ORDER BY ap.data_inicio DESC
      LIMIT 1
    `,
        [id_maquina],
      );

      if (result.rows.length === 0) {
        return res.json({
          em_producao: false,
          mensagem: "Nenhum produto em produção",
        });
      }

      const produto = result.rows[0];

      // Calcular eficiência atual
      const tempo_decorrido =
        (new Date() - new Date(produto.data_inicio)) / 1000; // segundos
      const pecas_produzidas = produto.quantidade_pecas || 0;

      // Determinar tempo padrão baseado no tipo de máquina
      const maquinaResult = await pool.query(
        "SELECT tipo_maquina FROM maquinas WHERE id = $1",
        [id_maquina],
      );
      const tipo_maquina = maquinaResult.rows[0]?.tipo_maquina;

      const tempo_ideal_por_peca = calcularTempoIdealProduto(
        produto,
        tipo_maquina,
      );
      const eficiencia_atual =
        tempo_ideal_por_peca && tempo_decorrido > 0
          ? ((pecas_produzidas * tempo_ideal_por_peca) / tempo_decorrido) * 100
          : 0;

      res.json({
        em_producao: true,
        produto: {
          id: produto.id_produto,
          descricao: produto.ds_produto,
          referencia: produto.referencia_produto,
          tempo_ideal_por_peca: tempo_ideal_por_peca,
          meta_horaria: getMetaHoraria(produto, tipo_maquina),
          pecas_por_ciclo: produto.pecas_por_ciclo || 1,
        },
        producao_atual: {
          quantidade_pecas: pecas_produzidas,
          tempo_decorrido_minutos: Math.round(tempo_decorrido / 60),
          eficiencia_atual: Math.max(0, eficiencia_atual),
        },
      });
    } catch (error) {
      console.error("Erro ao buscar produto atual:", error);
      res.status(500).json({ error: "Erro ao buscar produto em produção" });
    }
  },
);

function getMetaHoraria(produto, tipoMaquina) {
  switch (tipoMaquina) {
    case "MONTAGEM":
      return produto.meta_horaria_montagem;
    case "EMBALAGEM":
      return produto.meta_horaria_embalagem;
    case "INJETORA":
      return produto.meta_horaria_injecao;
    default:
      return null;
  }
}

// Rota para obter detalhes do produto atual em produção
app.get(
  "/api/maquina-produto-atual/:id_maquina",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_maquina } = req.params;

      const result = await pool.query(
        `
      SELECT 
        ap.id_produto,
        p.ds_produto,
        p.referencia_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao,
        p.pecas_por_ciclo,
        ap.quantidade_pecas,
        ap.data_inicio
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND ap.status = 'EM_ANDAMENTO'
      ORDER BY ap.data_inicio DESC
      LIMIT 1
    `,
        [id_maquina],
      );

      if (result.rows.length === 0) {
        return res.json({
          em_producao: false,
          mensagem: "Nenhum produto em produção",
        });
      }

      const produto = result.rows[0];

      // Calcular eficiência atual
      const tempo_decorrido =
        (new Date() - new Date(produto.data_inicio)) / 1000; // segundos
      const pecas_produzidas = produto.quantidade_pecas || 0;

      // Determinar tempo padrão baseado no tipo de máquina
      const maquinaResult = await pool.query(
        "SELECT tipo_maquina FROM maquinas WHERE id = $1",
        [id_maquina],
      );
      const tipo_maquina = maquinaResult.rows[0]?.tipo_maquina;

      const tempo_ideal_por_peca = calcularTempoIdealProduto(
        produto,
        tipo_maquina,
      );
      const eficiencia_atual =
        tempo_ideal_por_peca && tempo_decorrido > 0
          ? ((pecas_produzidas * tempo_ideal_por_peca) / tempo_decorrido) * 100
          : 0;

      res.json({
        em_producao: true,
        produto: {
          id: produto.id_produto,
          descricao: produto.ds_produto,
          referencia: produto.referencia_produto,
          tempo_ideal_por_peca: tempo_ideal_por_peca,
          meta_horaria: getMetaHoraria(produto, tipo_maquina),
          pecas_por_ciclo: produto.pecas_por_ciclo || 1,
        },
        producao_atual: {
          quantidade_pecas: pecas_produzidas,
          tempo_decorrido_minutos: Math.round(tempo_decorrido / 60),
          eficiencia_atual: Math.max(0, eficiencia_atual),
        },
      });
    } catch (error) {
      console.error("Erro ao buscar produto atual:", error);
      res.status(500).json({ error: "Erro ao buscar produto em produção" });
    }
  },
);

function getMetaHoraria(produto, tipoMaquina) {
  switch (tipoMaquina) {
    case "MONTAGEM":
      return produto.meta_horaria_montagem;
    case "EMBALAGEM":
      return produto.meta_horaria_embalagem;
    case "INJETORA":
      return produto.meta_horaria_injecao;
    default:
      return null;
  }
}

// Rota para obter dados consolidados de múltiplas máquinas
app.post("/api/dashboard-todas-maquinas", autenticarToken, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids)) {
      return res
        .status(400)
        .json({ error: "IDs das máquinas são obrigatórios" });
    }

    const resultados = {};

    // Buscar dados de cada máquina em paralelo
    await Promise.all(
      ids.map(async (idMaquina) => {
        try {
          const [oeeData, statusData, produtoData, operadorData] =
            await Promise.all([
              calcularOEE(idMaquina),
              getStatusMaquina(idMaquina),
              getProdutoAtual(idMaquina),
              getOperadorAtual(idMaquina),
            ]);

          resultados[idMaquina] = {
            oee: oeeData,
            status: statusData,
            produto: produtoData,
            operador: operadorData,
          };
        } catch (error) {
          console.error(`Erro ao buscar dados da máquina ${idMaquina}:`, error);
          resultados[idMaquina] = {
            oee: getOeeDataDefault(),
            status: getStatusDataDefault(),
            produto: getProdutoDataDefault(),
            operador: getOperadorDataDefault(),
          };
        }
      }),
    );

    res.json(resultados);
  } catch (error) {
    console.error("Erro na rota dashboard-todas-maquinas:", error);
    res.status(500).json({ error: "Erro ao buscar dados das máquinas" });
  }
});

// Função auxiliar para status da máquina
async function getStatusMaquina(idMaquina) {
  try {
    const statusResult = await pool.query(
      `
      SELECT status, data_inicio, motivo_parada_maquina
      FROM apontamento_producao 
      WHERE id_maquina = $1 
      AND (status IN ('EM_ANDAMENTO', 'PAUSADO', 'MAQUINA_PARADA') 
           OR (status = 'FINALIZADO' AND data_fim > NOW() - INTERVAL '5 minutes'))
      ORDER BY data_inicio DESC 
      LIMIT 1
    `,
      [idMaquina],
    );

    const status = statusResult.rows[0]
      ? statusResult.rows[0].status
      : "PARADA";
    const motivo = statusResult.rows[0]
      ? statusResult.rows[0].motivo_parada_maquina
      : "";

    // Buscar pulsos recentes
    const pulsosResult = await pool.query(
      `
      SELECT COUNT(*) as pulsos_recentes
      FROM apontamento_pulsos 
      WHERE id_maquina = $1 
      AND timestamp > NOW() - INTERVAL '1 minute'
    `,
      [idMaquina],
    );

    const pulsosRecentes = parseInt(pulsosResult.rows[0].pulsos_recentes);

    return {
      status,
      motivo,
      pulsosRecentes,
      ultimaAtualizacao: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Erro ao buscar status da máquina:", error);
    return getStatusDataDefault();
  }
}

// Função auxiliar para produto atual
async function getProdutoAtual(idMaquina) {
  try {
    const result = await pool.query(
      `
      SELECT 
        ap.id_produto,
        p.ds_produto,
        p.referencia_produto,
        p.tempo_padrao_montagem_segundos,
        p.tempo_padrao_embalagem_segundos,
        p.tempo_padrao_injecao_segundos,
        p.meta_horaria_montagem,
        p.meta_horaria_embalagem,
        p.meta_horaria_injecao,
        p.pecas_por_ciclo,
        ap.quantidade_pecas,
        ap.data_inicio
      FROM apontamento_producao ap
      LEFT JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.id_maquina = $1 
      AND ap.status = 'EM_ANDAMENTO'
      ORDER BY ap.data_inicio DESC
      LIMIT 1
    `,
      [idMaquina],
    );

    if (result.rows.length === 0) {
      return {
        em_producao: false,
        mensagem: "Nenhum produto em produção",
      };
    }

    const produto = result.rows[0];
    const agora = new Date();
    const tempo_decorrido = (agora - new Date(produto.data_inicio)) / 1000;
    const pecas_produzidas = produto.quantidade_pecas || 0;

    // Buscar tipo da máquina para cálculo de eficiência
    const maquinaResult = await pool.query(
      "SELECT tipo_maquina FROM maquinas WHERE id = $1",
      [idMaquina],
    );
    const tipo_maquina = maquinaResult.rows[0]?.tipo_maquina;

    const tempo_ideal_por_peca = calcularTempoIdealProduto(
      produto,
      tipo_maquina,
    );
    const eficiencia_atual =
      tempo_ideal_por_peca && tempo_decorrido > 0
        ? ((pecas_produzidas * tempo_ideal_por_peca) / tempo_decorrido) * 100
        : 0;

    return {
      em_producao: true,
      produto: {
        id: produto.id_produto,
        descricao: produto.ds_produto,
        referencia: produto.referencia_produto,
        tempo_ideal_por_peca: tempo_ideal_por_peca,
        meta_horaria: getMetaHoraria(produto, tipo_maquina),
        pecas_por_ciclo: produto.pecas_por_ciclo || 1,
      },
      producao_atual: {
        quantidade_pecas: pecas_produzidas,
        tempo_decorrido_minutos: Math.round(tempo_decorrido / 60),
        eficiencia_atual: (0, eficiencia_atual),
      },
    };
  } catch (error) {
    console.error("Erro ao buscar produto atual:", error);
    return getProdutoDataDefault();
  }
}

// Funções padrão para fallback
function getOeeDataDefault() {
  return {
    disponibilidade: 0,
    performance: 0,
    qualidade: 100,
    oee: 0,
    metricas: {
      tempo_produtivo_minutos: 0,
      tempo_parado_minutos: 0,
      tempo_total_minutos: 0,
      pecas_produzidas: 0,
      pecas_boas: 0,
      refugo_total: 0,
      tempo_ideal_minutos: 0,
      tempo_real_minutos: 0,
      eficiencia_calculada: 0,
    },
    tipo_maquina: "DESCONHECIDO",
  };
}

function getStatusDataDefault() {
  return {
    status: "PARADA",
    motivo: "",
    pulsosRecentes: 0,
    ultimaAtualizacao: new Date().toISOString(),
  };
}

function getProdutoDataDefault() {
  return {
    em_producao: false,
    mensagem: "Aguardando produção...",
  };
}

// Adicionar esta função auxiliar para buscar operador atual
async function getOperadorAtual(idMaquina) {
  try {
    const result = await pool.query(
      `
      SELECT 
        o.id,
        o.nome,
        o.tipo_operador,
        ap.data_inicio
      FROM apontamento_producao ap
      INNER JOIN operadores o ON ap.id_operador = o.id
      WHERE ap.id_maquina = $1 
      AND ap.status = 'EM_ANDAMENTO'
      ORDER BY ap.data_inicio DESC
      LIMIT 1
    `,
      [idMaquina],
    );

    if (result.rows.length === 0) {
      return {
        em_apontamento: false,
        mensagem: "Sem operador ativo",
      };
    }

    const operador = result.rows[0];

    return {
      em_apontamento: true,
      operador: {
        id: operador.id,
        nome: operador.nome,
        tipo_operador: operador.tipo_operador,
      },
      data_inicio: operador.data_inicio,
    };
  } catch (error) {
    console.error("Erro ao buscar operador atual:", error);
    return {
      em_apontamento: false,
      mensagem: "Erro ao buscar operador",
    };
  }
}

// Adicionar função padrão para operador
function getOperadorDataDefault() {
  return {
    em_apontamento: false,
    mensagem: "Sem operador ativo",
  };
}

async function monitorarQuantidadePecas(maquinaId, socket) {
  console.log(`👁️ Monitorando quantidade_pecas da máquina ${maquinaId}`);

  // Intervalo de 2 segundos (bem leve)
  const intervalId = setInterval(async () => {
    try {
      const result = await pool.query(
        `
        SELECT quantidade_pecas, data_atualizacao
        FROM apontamento_producao 
        WHERE id_maquina = $1 
          AND status IN ('EM_ANDAMENTO', 'FINALIZADO')
        ORDER BY data_atualizacao DESC 
        LIMIT 1
      `,
        [maquinaId],
      );

      if (result.rows.length > 0) {
        const { quantidade_pecas, data_atualizacao } = result.rows[0];

        // Verificar cache simples
        const cacheKey = `maquina_${maquinaId}`;
        const ultimaQuantidade = monitoramentoProducao.get(cacheKey);

        if (ultimaQuantidade !== quantidade_pecas) {
          // Atualizar cache
          monitoramentoProducao.set(cacheKey, quantidade_pecas);

          // 🔥 ENVIAR APENAS A QUANTIDADE para o frontend
          socket.emit("quantidade_pecas_atualizada", {
            id_maquina: maquinaId,
            quantidade_pecas: quantidade_pecas,
            data_atualizacao: data_atualizacao,
            timestamp: new Date().toISOString(),
          });

          console.log(`📦 Máquina ${maquinaId}: ${quantidade_pecas} peças`);
        }
      }
    } catch (error) {
      console.error(`Erro ao monitorar máquina ${maquinaId}:`, error);
    }
  }, 2000);

  // Armazenar para limpar depois
  if (!socket.monitoramentosPecas) socket.monitoramentosPecas = {};
  socket.monitoramentosPecas[maquinaId] = intervalId;
}

// 2. Função para limpar monitoramento
function limparMonitoramentoPecas(socket, maquinaId) {
  if (socket.monitoramentosPecas && socket.monitoramentosPecas[maquinaId]) {
    clearInterval(socket.monitoramentosPecas[maquinaId]);
    delete socket.monitoramentosPecas[maquinaId];
  }
}

async function calcularOEEAjustado(idMaquina, periodo = "diario") {
  try {
    // Definir período base
    let dataInicio, dataFim;
    const agora = new Date();

    switch (periodo) {
      case "diario":
        dataInicio = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          agora.getDate(),
          6,
          0,
          0,
        );
        dataFim = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          agora.getDate() + 1,
          5,
          59,
          59,
        );
        break;
      case "semanal":
        dataInicio = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          agora.getDate() - 7,
          6,
          0,
          0,
        );
        dataFim = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          agora.getDate() + 1,
          5,
          59,
          59,
        );
        break;
      default: // mensal
        dataInicio = new Date(
          agora.getFullYear(),
          agora.getMonth() - 1,
          agora.getDate(),
          6,
          0,
          0,
        );
        dataFim = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          agora.getDate() + 1,
          5,
          59,
          59,
        );
    }

    const result = await pool.query(
      `
      WITH todas_paradas AS (
        -- Paradas da tabela paradas_producao
        SELECT 
          pp.id_apontamento,
          pp.motivo_parada,
          pp.data_inicio,
          pp.data_fim,
          'TABELA_PARADAS' as origem
        FROM paradas_producao pp
        INNER JOIN apontamento_producao ap ON pp.id_apontamento = ap.id
        WHERE ap.id_maquina = $1 
        AND pp.data_inicio BETWEEN $2 AND $3
        
        UNION ALL
        
        -- Paradas do campo motivo_parada_maquina (fallback)
        SELECT 
          ap.id as id_apontamento,
          ap.motivo_parada_maquina as motivo_parada,
          ap.data_inicio as data_inicio,
          ap.data_fim as data_fim,
          'CAMPO_MAQUINA' as origem
        FROM apontamento_producao ap
        WHERE ap.id_maquina = $1 
        AND ap.motivo_parada_maquina IS NOT NULL
        AND ap.data_inicio BETWEEN $2 AND $3
        AND ap.status = 'MAQUINA_PARADA'
      ),
      paradas_classificadas AS (
        SELECT 
          *,
          CASE 
            WHEN motivo_parada IN ('Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva') 
            THEN 'PROGRAMADA'
            ELSE 'NAO_PROGRAMADA'
          END as tipo_parada
        FROM todas_paradas
      ),
      tempos_calculados AS (
        SELECT 
          -- Tempo Produtivo
          SUM(CASE 
            WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
              EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, $4) - ap.data_inicio))
            ELSE 0 
          END) as tempo_produtivo,
          
          -- Tempo Parado Não Programado (de AMBAS as fontes)
          SUM(CASE 
            WHEN (ap.status IN ('PAUSADO', 'MAQUINA_PARADA') OR pc.motivo_parada IS NOT NULL)
            AND pc.tipo_parada = 'NAO_PROGRAMADA' THEN 
              EXTRACT(EPOCH FROM (
                COALESCE(pc.data_fim, COALESCE(ap.data_fim, $4)) - 
                GREATEST(pc.data_inicio, ap.data_inicio)
              ))
            ELSE 0 
          END) as tempo_parado_nao_programado,
          
          -- Produção
          SUM(ap.quantidade_pecas) as pecas_produzidas,
          SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) as pecas_boas,
          SUM(ap.refugo_kg) as refugo_total
          
        FROM apontamento_producao ap
        LEFT JOIN paradas_classificadas pc ON ap.id = pc.id_apontamento
        WHERE ap.id_maquina = $1 
        AND ap.data_inicio BETWEEN $2 AND $3
        GROUP BY ap.id_maquina
      )
      
      SELECT * FROM tempos_calculados
    `,
      [idMaquina, dataInicio, dataFim, agora],
    );

    const dados = result.rows[0];

    // Cálculos OEE ajustados
    const tempoOperacional =
      dados.tempo_produtivo + dados.tempo_parado_nao_programado;
    const disponibilidade =
      tempoOperacional > 0
        ? (dados.tempo_produtivo / tempoOperacional) * 100
        : 0;

    // Performance baseada em tempo ideal (simplificado)
    const performance = await calcularPerformanceAjustada(
      idMaquina,
      dataInicio,
      dataFim,
    );

    // Qualidade
    const qualidade =
      dados.pecas_produzidas > 0
        ? (dados.pecas_boas / dados.pecas_produzidas) * 100
        : 100;

    const oee = (disponibilidade * performance * qualidade) / 10000;

    return {
      disponibilidade: Math.min(100, Math.max(0, disponibilidade)),
      performance: Math.min(100, Math.max(0, performance)),
      qualidade: Math.min(100, Math.max(0, qualidade)),
      oee: Math.min(100, Math.max(0, oee)),
      metricas: {
        tempo_produtivo_minutos: Math.round(dados.tempo_produtivo / 60),
        tempo_parado_nao_programado_minutos: Math.round(
          dados.tempo_parado_nao_programado / 60,
        ),
        pecas_produzidas: dados.pecas_produzidas,
        pecas_boas: dados.pecas_boas,
        refugo_total: dados.refugo_total,
      },
    };
  } catch (error) {
    console.error("Erro no cálculo OEE ajustado:", error);
    return getOeeDataDefault();
  }
}

app.get("/api/oee-ajustado/:id_maquina", autenticarToken, async (req, res) => {
  try {
    const { id_maquina } = req.params;
    const oeeData = await calcularOEEAjustado(parseInt(id_maquina));
    res.json(oeeData);
  } catch (error) {
    console.error("Erro na rota OEE ajustado:", error);
    res.status(500).json({ error: "Erro ao calcular OEE ajustado" });
  }
});

// ✅ Rota para OEE por operador com métrica ponderada
app.get("/api/oee-por-operador-ajustado", autenticarToken, async (req, res) => {
  try {
    const { dias = "7" } = req.query; // ✅ Padrão 7 dias como antes
    const diasInt = parseInt(dias);

    // ✅ VALIDAÇÃO para evitar NaN - igual ao original
    const diasValidados = isNaN(diasInt) || diasInt <= 0 ? 7 : diasInt;

    console.log(
      `📊 Buscando OEE por operador AJUSTADO - últimos ${diasValidados} dias`,
    );

    const result = await pool.query(`
      WITH dias_trabalhados AS (
        SELECT 
          id_operador,
          COUNT(DISTINCT DATE(data_inicio)) as dias_trabalhados,
          SUM(EXTRACT(EPOCH FROM (COALESCE(data_fim, NOW()) - data_inicio)) / 3600) as horas_trabalhadas
        FROM apontamento_producao
        WHERE data_inicio >= CURRENT_DATE - INTERVAL '${diasValidados} days'
        AND status IN ('EM_ANDAMENTO', 'FINALIZADO')
        GROUP BY id_operador
      ),
      oee_por_dia AS (
        SELECT 
          ap.id_operador,
          DATE(ap.data_inicio) as data,
          -- Cálculo OEE por dia (simplificado)
          (SUM(CASE WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO') THEN 
            EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)) ELSE 0 END) /
          NULLIF(SUM(CASE WHEN ap.status IN ('EM_ANDAMENTO', 'FINALIZADO', 'PAUSADO', 'MAQUINA_PARADA') 
            AND (ap.motivo_parada_maquina IS NULL OR ap.motivo_parada_maquina NOT IN ('Horário de refeição', 'Troca de Turno')) THEN 
            EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)) ELSE 0 END), 0)) *
          COALESCE(AVG(CASE 
            WHEN p.tempo_padrao_montagem_segundos > 0 AND ap.quantidade_pecas > 0 THEN
              (ap.quantidade_pecas * p.tempo_padrao_montagem_segundos) / 
              NULLIF(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)), 0)
            ELSE 0.8
          END), 0.8) *
          (SUM(COALESCE(ap.pecas_boas, ap.quantidade_pecas * 0.98)) / NULLIF(SUM(ap.quantidade_pecas), 0)) * 100
          as oee_dia,
          
          SUM(EXTRACT(EPOCH FROM (COALESCE(ap.data_fim, NOW()) - ap.data_inicio)) / 3600) as horas_dia
        FROM apontamento_producao ap
        LEFT JOIN produtos p ON ap.id_produto = p.id
        WHERE ap.data_inicio >= CURRENT_DATE - INTERVAL '${diasValidados} days'
        AND ap.status IN ('EM_ANDAMENTO', 'FINALIZADO')
        GROUP BY ap.id_operador, DATE(ap.data_inicio)
      )
      SELECT 
        o.id,
        o.nome,
        o.turno,
        o.tipo_operador,
        dt.dias_trabalhados,
        dt.horas_trabalhadas,
        ROUND(SUM(od.oee_dia * od.horas_dia) / NULLIF(SUM(od.horas_dia), 0), 2) as oee_ponderado,
        ROUND(AVG(od.oee_dia), 2) as oee_medio,
        SUM(ap.quantidade_pecas) as pecas_produzidas,
        COUNT(ap.id) as total_apontamentos
      FROM operadores o
      LEFT JOIN dias_trabalhados dt ON o.id = dt.id_operador
      LEFT JOIN oee_por_dia od ON o.id = od.id_operador
      LEFT JOIN apontamento_producao ap ON o.id = ap.id_operador 
        AND ap.data_inicio >= CURRENT_DATE - INTERVAL '${diasValidados} days'
      WHERE o.tipo_operador NOT IN ('Gestão', 'Desligado')
      GROUP BY o.id, o.nome, o.turno, o.tipo_operador, dt.dias_trabalhados, dt.horas_trabalhadas
      HAVING SUM(od.horas_dia) > 0 OR SUM(ap.quantidade_pecas) > 0
      ORDER BY oee_ponderado DESC NULLS LAST
    `);

    console.log(
      `✅ Encontrados ${result.rows.length} operadores com produção (AJUSTADO)`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar OEE por operador ajustado:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar dados", details: error.message });
  }
});

// Rotas para produção agendada (usada no Kanban)
planejamentoRouter.get("/agendadas", autenticarToken, async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;

    let query = `
      SELECT 
        p.*,
        m.codigo as molde_codigo,
        m.descricao as molde_descricao,
        maq.descricao as maquina_descricao,
        pr.referencia_produto,
        pr.ds_produto as produto_descricao
      FROM planejamento_producao p
      JOIN moldes m ON p.id_molde = m.id
      JOIN maquinas maq ON p.id_maquina = maq.id
      LEFT JOIN moldes_produtos mp ON mp.id_versao_molde IN (
        SELECT id FROM moldes_versoes WHERE id_molde = m.id
      )
      LEFT JOIN produtos pr ON mp.id_produto = pr.id
      WHERE p.data_inicio BETWEEN $1 AND $2
      ORDER BY p.data_inicio
    `;

    const result = await pool.query(query, [
      data_inicio || new Date().toISOString(),
      data_fim || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ]);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar produções agendadas" });
  }
});

router.get("/tipos-movimentacao", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, descricao, operacao 
      FROM tipos_movimentacao 
      WHERE ativo = true 
      ORDER BY descricao
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar tipos de movimentação:", error);
    res.status(500).json({
      error: "Erro ao buscar tipos de movimentação",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.use(async (req, res, next) => {
  try {
    // Testar a conexão com uma query simples
    await pool.query("SELECT 1");
    next();
  } catch (error) {
    console.error("❌ Middleware: Conexão com banco perdida:", error.code);

    if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED") {
      try {
        // Tentar reconectar
        await pool.query("SELECT 1");
        next();
      } catch (retryError) {
        console.error("❌ Middleware: Falha na reconexão:", retryError.code);
        res.status(503).json({
          error: "Serviço temporariamente indisponível",
          details: "Problema de conexão com o banco de dados",
        });
      }
    } else {
      next(error);
    }
  }
});

app.use("/api/enderecamento", enderecamentoRouter);
// Montar as rotas no app principal
app.use("/planejamento", planejamentoRouter);

// Rotas para o Kanban de Produção
const kanbanRouter = express.Router();

// Obter produções por status (para as colunas do Kanban)
kanbanRouter.get("/producoes", autenticarToken, async (req, res) => {
  try {
    const { status } = req.query;

    if (!status) {
      return res
        .status(400)
        .json({ message: "Parâmetro status é obrigatório" });
    }

    const result = await pool.query(
      `SELECT 
        p.*,
        m.codigo as molde_codigo,
        m.descricao as molde_descricao,
        maq.descricao as maquina_descricao,
        pr.referencia_produto,
        pr.ds_produto as produto_descricao,
        t.inicio as inicio_turno,
        t.fim as fim_turno
      FROM planejamento_producao p
      JOIN moldes m ON p.id_molde = m.id
      JOIN maquinas maq ON p.id_maquina = maq.id
      LEFT JOIN moldes_produtos mp ON mp.id_versao_molde IN (
        SELECT id FROM moldes_versoes WHERE id_molde = m.id
      )
      LEFT JOIN produtos pr ON mp.id_produto = pr.id
      LEFT JOIN turnos t ON p.turno = t.nome
      WHERE p.status = $1
      ORDER BY p.data_inicio`,
      [status],
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar produções" });
  }
});

// Obter configuração dos turnos
kanbanRouter.get("/turnos", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM turnos ORDER BY nome");
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar turnos" });
  }
});

// Obter máquinas por tipo (para filtros)
kanbanRouter.get("/maquinas", autenticarToken, async (req, res) => {
  try {
    const { tipo } = req.query;

    let query = "SELECT id, descricao FROM maquinas WHERE ativo = true";
    const params = [];

    if (tipo) {
      query += " AND tipo_maquina = $1";
      params.push(tipo);
    }

    query += " ORDER BY descricao";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar máquinas" });
  }
});

// Montar as rotas no app principal
app.use("/kanban", kanbanRouter);

// Rota para buscar todos os produtos do AWORKS (sem limite)
app.get("/produtos-aworks/all", async (req, res) => {
  try {
    const result = await poolSeven.query(
      `SELECT produtoid, referencia_produto, ds_produto FROM produto
       where empresaid = 1
       and status_produto = 'ATIVO' 
       and tp_produto = 'COMPONENTE'`,
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar todos os produtos do AWORKS:", err);
    res.status(500).json({
      message: "Erro ao buscar produtos do AWORKS",
      error: err.message,
    });
  }
});

// Rota para listar ordens com informações completas
app.get("/ordem-producao/completo", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        op.*, 
        m.id as molde_id, m.codigo as molde_codigo, m.descricao as molde_descricao, m.cavidades,
        p.referencia_produto, p.ds_produto
      FROM ordem_producao op
      LEFT JOIN moldes m ON op.id_molde = m.id
      LEFT JOIN produtos p ON op.id_produto = p.id
      ORDER BY op.id
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar ordens" });
  }
});

// ROTA ATUALIZA VERSÃO
app.put(
  "/moldes/:idMolde/versoes/:idVersao",
  autenticarToken,
  [body("versao").notEmpty().withMessage("Versão é obrigatória")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { idMolde, idVersao } = req.params;
    const { versao } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Verifica se a versão pertence ao molde
      const versaoExistente = await client.query(
        "SELECT id FROM moldes_versoes WHERE id = $1 AND id_molde = $2",
        [idVersao, idMolde],
      );

      if (versaoExistente.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ message: "Versão não encontrada para este molde" });
      }

      // Verifica se a nova versão já existe
      const versaoDuplicada = await client.query(
        "SELECT id FROM moldes_versoes WHERE versao = $1 AND id_molde = $2 AND id != $3",
        [versao, idMolde, idVersao],
      );

      if (versaoDuplicada.rows.length > 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "Já existe uma versão com este número" });
      }

      // Atualiza apenas a versão
      const result = await client.query(
        `UPDATE moldes_versoes 
       SET versao = $1,
           data_atualizacao = NOW()
       WHERE id = $2
       RETURNING id, versao, data_criacao, data_atualizacao`,
        [versao, idVersao],
      );

      await client.query("COMMIT");
      res.status(200).json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Erro ao atualizar versão:", err);
      res.status(500).json({ message: "Erro ao atualizar versão" });
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/moldes/:idVersao/produtos/:idAssociacao",
  autenticarToken,
  async (req, res) => {
    const { idVersao, idAssociacao } = req.params;

    console.log("Tentando excluir associação:", { idVersao, idAssociacao });

    try {
      // 1. Primeiro verifica se existe
      const existe = await pool.query(
        "SELECT id FROM moldes_produtos WHERE id = $1 AND id_versao_molde = $2",
        [idAssociacao, idVersao],
      );

      if (existe.rows.length === 0) {
        return res.status(404).json({
          message: "Associação não encontrada",
          details: `ID Versão: ${idVersao}, ID Associação: ${idAssociacao}`,
        });
      }

      // 2. Executa a exclusão
      await pool.query("DELETE FROM moldes_produtos WHERE id = $1", [
        idAssociacao,
      ]);

      res.json({ success: true });
    } catch (err) {
      console.error("Erro durante exclusão:", err);
      res.status(500).json({
        message: "Erro ao excluir associação",
        error: err.message,
      });
    }
  },
);

// Rota para excluir versão
app.delete(
  "/moldes/:idMolde/versoes/:idVersao",
  autenticarToken,
  async (req, res) => {
    const { idMolde, idVersao } = req.params;

    try {
      await pool.query("BEGIN");

      // 1. Primeiro exclui os produtos associados
      await pool.query(
        "DELETE FROM moldes_produtos WHERE id_versao_molde = $1",
        [idVersao],
      );

      // 2. Depois exclui a versão
      await pool.query(
        "DELETE FROM moldes_versoes WHERE id = $1 AND id_molde = $2",
        [idVersao, idMolde],
      );

      await pool.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await pool.query("ROLLBACK");
      res.status(500).json({ message: "Erro ao excluir versão" });
    }
  },
);

// Rota para excluir molde
app.delete("/moldes/:id", autenticarToken, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("BEGIN");

    // 1. Exclui produtos das versões
    await pool.query(
      `
      DELETE FROM moldes_produtos 
      WHERE id_versao_molde IN (
        SELECT id FROM moldes_versoes WHERE id_molde = $1
      )`,
      [id],
    );

    // 2. Exclui versões
    await pool.query("DELETE FROM moldes_versoes WHERE id_molde = $1", [id]);

    // 3. Exclui o molde
    await pool.query("DELETE FROM moldes WHERE id = $1", [id]);

    await pool.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ message: "Erro ao excluir molde" });
  }
});

// Rota para listar máquinas
app.get("/maquinas", autenticarToken, async (req, res) => {
  try {
    const { tipo } = req.query;

    let query = "SELECT * FROM maquinas WHERE ativo = true";
    const params = [];

    if (tipo) {
      query += " AND tipo_maquina = $1";
      params.push(tipo);
    }

    query += " ORDER BY descricao";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erro ao buscar máquinas",
      error: err.message,
    });
  }
});

// Rota para excluir máquina
app.delete("/maquinas/:id", autenticarToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Verifica se a máquina existe
    const existe = await pool.query("SELECT id FROM maquinas WHERE id = $1", [
      id,
    ]);
    if (existe.rows.length === 0) {
      return res.status(404).json({ message: "Máquina não encontrada" });
    }

    // Exclusão lógica (recomendado)
    const result = await pool.query(
      "UPDATE maquinas SET ativo = false WHERE id = $1 RETURNING *",
      [id],
    );

    // Ou exclusão física (se necessário)
    // const result = await pool.query('DELETE FROM maquinas WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Máquina não encontrada" });
    }

    res.status(200).json({
      success: true,
      message: "Máquina desativada com sucesso",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Erro ao excluir máquina",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
});

// Rota corrigida para exclusão (usando o ID da associação)
app.delete(
  "/moldes/versoes/:idVersao/produtos/:idAssociacao",
  autenticarToken,
  async (req, res) => {
    const { idVersao, idAssociacao } = req.params;

    try {
      await pool.query(
        "DELETE FROM moldes_produtos WHERE id = $1 AND id_versao_molde = $2",
        [idAssociacao, idVersao],
      );

      res.status(200).json({ success: true });
    } catch (err) {
      console.error("Erro ao excluir produto:", err);
      res.status(500).json({ message: "Erro ao excluir produto" });
    }
  },
);

// Rota para obter detalhes específicos de uma ordem
app.get("/ordem-producao/:id/detalhes", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        op.*, 
        m.id as molde_id, m.codigo as molde_codigo, m.descricao as molde_descricao, m.cavidades,
        p.referencia_produto, p.ds_produto,
        (
          SELECT json_agg(mp.*) 
          FROM moldes_produtos mp 
          WHERE mp.id_versao_molde IN (
            SELECT id FROM moldes_versoes WHERE id_molde = m.id
          )
        ) as produtos_molde
      FROM ordem_producao op
      LEFT JOIN moldes m ON op.id_molde = m.id
      LEFT JOIN produtos p ON op.id_produto = p.id
      WHERE op.id = $1
    `,
      [req.params.id],
    );

    res.status(200).json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar ordem" });
  }
});

// Rota para atualizar molde
app.put(
  "/moldes/:id",
  autenticarToken,
  [
    body("codigo").notEmpty().withMessage("Código é obrigatório"),
    body("descricao").notEmpty().withMessage("Descrição é obrigatória"),
    body("maquinas").isArray().withMessage("Máquinas deve ser um array"),
    body("cavidades")
      .isInt({ min: 1 })
      .withMessage("Cavidades deve ser um número positivo"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { codigo, descricao, maquinas, cavidades, ativo } = req.body;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Atualizar informações básicas do molde
      const result = await client.query(
        `UPDATE moldes 
       SET codigo = $1, descricao = $2, cavidades = $3, ativo = $4
       WHERE id = $5
       RETURNING *`,
        [codigo, descricao, cavidades, ativo !== false, id],
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Molde não encontrado" });
      }

      // 2. Atualizar máquinas vinculadas
      await client.query("DELETE FROM moldes_maquinas WHERE id_molde = $1", [
        id,
      ]);

      if (maquinas && maquinas.length > 0) {
        for (const maquinaId of maquinas) {
          await client.query(
            "INSERT INTO moldes_maquinas (id_molde, id_maquina) VALUES ($1, $2)",
            [id, maquinaId],
          );
        }
      }

      await client.query("COMMIT");
      res.status(200).json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");

      if (err.code === "23505") {
        return res
          .status(400)
          .json({ message: "Já existe um molde com este código" });
      }

      console.error("Erro ao atualizar molde:", err);
      res.status(500).json({ message: "Erro ao atualizar molde" });
    } finally {
      client.release();
    }
  },
);

// Rota para obter moldes disponíveis para um produto
app.get("/ordem-producao/moldes-disponiveis/:idProduto", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT DISTINCT m.*
      FROM moldes m
      JOIN moldes_versoes mv ON m.id = mv.id_molde
      JOIN moldes_produtos mp ON mv.id = mp.id_versao_molde
      WHERE mp.id_produto = $1 OR mp.referencia_produto = (
        SELECT referencia_produto FROM produtos WHERE id = $1
      )
    `,
      [req.params.idProduto],
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar moldes" });
  }
});

// Rota para atualizar apenas o molde de uma ordem
app.patch(
  "/ordem-producao/:id/molde",
  [body("id_molde").optional().isInt()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { id_molde } = req.body;

    try {
      await pool.query(
        "UPDATE ordem_producao SET id_molde = $1 WHERE id = $2",
        [id_molde || null, req.params.id],
      );
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao atualizar molde" });
    }
  },
);

// Rota para adicionar produto a uma versão com cavidades
app.post(
  "/moldes/versoes/:idVersao/produtos",
  [
    body("id_produto").isInt().withMessage("ID do produto deve ser inteiro"),
    body("cavidades").notEmpty().withMessage("Cavidades são obrigatórias"),
    body("referencia_produto").optional().isString(),
    body("descricao_produto").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { idVersao } = req.params;
    const { id_produto, cavidades, referencia_produto, descricao_produto } =
      req.body;

    try {
      // Verificação adicional
      if (isNaN(id_produto)) {
        return res
          .status(400)
          .json({ message: "ID do produto deve ser numérico" });
      }

      const result = await pool.query(
        `INSERT INTO moldes_produtos 
       (id_versao_molde, id_produto, referencia_produto, descricao_produto, cavidades) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          idVersao,
          parseInt(id_produto),
          referencia_produto,
          descricao_produto,
          cavidades,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro no banco de dados:", err);
      res.status(500).json({
        message: "Erro ao adicionar produto ao molde",
        detail:
          process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
);

// Rota para atualizar cavidades de um produto
app.put(
  "/moldes/versoes/:idVersao/produtos/:idProduto",
  [
    body("cavidades")
      .isInt({ min: 1 })
      .withMessage("Número de cavidades deve ser pelo menos 1"),
  ],
  async (req, res) => {
    const { idVersao, idProduto } = req.params;
    const { cavidades } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Atualizar cavidades
      const result = await client.query(
        `UPDATE moldes_produtos SET cavidades = $1
       WHERE id_versao_molde = $2 AND id_produto = $3
       RETURNING *`,
        [cavidades, idVersao, idProduto],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ message: "Produto não encontrado nesta versão" });
      }

      // 2. Atualizar total de cavidades do molde
      const versao = await client.query(
        "SELECT id_molde FROM moldes_versoes WHERE id = $1",
        [idVersao],
      );

      await client.query(
        `UPDATE moldes SET cavidades = (
        SELECT SUM(cavidades) FROM moldes_produtos
        JOIN moldes_versoes ON moldes_produtos.id_versao_molde = moldes_versoes.id
        WHERE moldes_versoes.id_molde = $1
      ) WHERE id = $1`,
        [versao.rows[0].id_molde],
      );

      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      res.status(500).json({ message: "Erro ao atualizar cavidades" });
    } finally {
      client.release();
    }
  },
);

// Nova rota para previsões
app.post("/ml/prever-tempo", autenticarToken, async (req, res) => {
  try {
    const { id_produto, id_maquina, id_operador, quantidade } = req.body;
    const previsao = await mlService.preverTempoProducao(
      id_produto,
      id_maquina,
      id_operador,
      quantidade,
    );
    res.json(previsao);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao gerar previsão" });
  }
});

// Rota para detecção de anomalias
app.get(
  "/ml/detectar-anomalias/:id_apontamento",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_apontamento } = req.params;
      const anomalias = await mlService.detectarAnomalias(id_apontamento);
      res.json({ anomalias });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao detectar anomalias" });
    }
  },
);

//Rota para log frontend
app.post("/logs/frontend", async (req, res) => {
  try {
    const { tipo_evento, mensagem, dados, nivel } = req.body;

    await pool.query(
      "INSERT INTO logs_apontamento (id_operador, tipo_evento, mensagem, dados, nivel, origem) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        dados.id_operador || null,
        tipo_evento,
        mensagem,
        dados,
        nivel || "INFO",
        "FRONTEND",
      ],
    );

    res.status(200).json({ status: "OK" });
  } catch (err) {
    console.error("Erro ao registrar log do frontend:", err);
    res.status(500).json({ message: "Erro ao registrar log" });
  }
});

function normalizarMetabaseSiteUrl(rawUrl) {
  const fallbackUrl = "http://192.168.10.246:3000";
  const original = (rawUrl || fallbackUrl).trim().replace(/^['\"]|['\"]$/g, "");

  const configuredPath = (process.env.MB_SITE_PATH || "").trim();
  const normalizedPath = configuredPath
    ? configuredPath.startsWith("/")
      ? configuredPath
      : `/${configuredPath}`
    : "";

  try {
    const parsed = new URL(original);
    const currentPath = (parsed.pathname || "/").replace(/\/+$/, "");

    if ((currentPath === "" || currentPath === "/") && normalizedPath) {
      parsed.pathname = normalizedPath;
    }

    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    // Se a URL vier sem esquema, usa fallback para evitar quebrar o embed.
    console.warn("MB_SITE_URL inválida, aplicando fallback:", original);
    return fallbackUrl;
  }
}

const METABASE_SITE_URL = normalizarMetabaseSiteUrl(
  process.env.MB_SITE_URL ||
    process.env.METABASE_SITE_URL ||
    process.env.METABASE_URL ||
    "http://192.168.10.246:3000"
);

function getMetabaseSecret() {
  const candidates = [
    ["MB_EMBEDDING_SECRET_KEY", process.env.MB_EMBEDDING_SECRET_KEY],
    ["METABASE_EMBEDDING_SECRET_KEY", process.env.METABASE_EMBEDDING_SECRET_KEY],
    ["METABASE_SECRET_KEY", process.env.METABASE_SECRET_KEY],
    ["EMBEDDING_SECRET_KEY", process.env.EMBEDDING_SECRET_KEY],
  ];

  for (const [name, value] of candidates) {
    if (typeof value === "string" && value.trim()) {
      const sanitized = value.trim().replace(/^['\"]|['\"]$/g, "");
      console.log(`[Metabase] usando chave de embedding de ${name} (len=${sanitized.length})`);
      return sanitized;
    }
  }

  return "";
}

const METABASE_SECRET_KEY = getMetabaseSecret();
console.log(`[Metabase] URL base de embed: ${METABASE_SITE_URL}`);

const METABASE_DEFAULT_DASHBOARD_ID = Number.parseInt(
  process.env.MB_DEFAULT_DASHBOARD_ID || process.env.METABASE_DEFAULT_DASHBOARD_ID || "7",
  10
);

function gerarIframeMetabase(dashboardId, res) {
  if (!Number.isInteger(dashboardId)) {
    return res.status(400).json({ message: "Dashboard ID inválido" });
  }

  if (!METABASE_SECRET_KEY) {
    return res.status(500).json({
      message: "Chave de embedding do Metabase não configurada",
    });
  }

  const payload = {
    resource: { dashboard: dashboardId },
    params: {},
    exp: Math.round(Date.now() / 1000) + 30 * 60,
  };

  try {
    const token = jwt.sign(payload, METABASE_SECRET_KEY);
    const iframeUrl = `${METABASE_SITE_URL}/embed/dashboard/${token}#bordered=true&titled=true`;
    return res.status(200).json({ iframeUrl });
  } catch (error) {
    console.error("Erro ao gerar URL de incorporação:", error);
    return res.status(500).json({ message: "Erro ao gerar URL de incorporação" });
  }
}

// Rotas do Metabase sem e com prefixo /api para compatibilidade
app.get("/metabase/embed-url/:dashboardId", (req, res) => {
  console.log("Gerando URL de incorporação do Metabase para dashboard:", req.params.dashboardId);
  return gerarIframeMetabase(parseInt(req.params.dashboardId, 10), res);
});

app.get("/api/metabase/embed-url/:dashboardId", (req, res) => {
  console.log("Gerando URL de incorporação do Metabase (/api) para dashboard:", req.params.dashboardId);
  return gerarIframeMetabase(parseInt(req.params.dashboardId, 10), res);
});

// Rota legada para compatibilidade (dashboard padrao configuravel)
app.get("/metabase/embed-url", (req, res) => {
  console.log(
    "Gerando URL de incorporação do Metabase (dashboard padrão):",
    METABASE_DEFAULT_DASHBOARD_ID
  );
  return gerarIframeMetabase(METABASE_DEFAULT_DASHBOARD_ID, res);
});

app.get("/api/metabase/embed-url", (req, res) => {
  console.log(
    "Gerando URL de incorporação do Metabase (/api, dashboard padrão):",
    METABASE_DEFAULT_DASHBOARD_ID
  );
  return gerarIframeMetabase(METABASE_DEFAULT_DASHBOARD_ID, res);
});

// Rota protegida para listar operadores
app.get("/operadores", autenticarToken, async (req, res) => {
  try {
    if (!podeGerenciarOperadores(req.user)) {
      return res.status(403).json({
        message:
          "Acesso negado: apenas perfis autorizados podem listar operadores",
      });
    }

    const result = await pool.query(
      "SELECT id, nome, email, administrador, turno, tipo_operador, data_cadastro FROM operadores ORDER BY nome",
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar operadores" });
  }
});

// Rotas para Moldes
app.get("/moldes", autenticarToken, async (req, res) => {
  try {
    const moldesResult = await pool.query(`
      SELECT m.* FROM moldes m ORDER BY m.codigo
    `);

    const moldes = moldesResult.rows;

    // Obter máquinas para cada molde
    for (const molde of moldes) {
      const maquinasResult = await pool.query(
        `
        SELECT maq.id, maq.descricao 
        FROM maquinas maq
        JOIN moldes_maquinas mm ON maq.id = mm.id_maquina
        WHERE mm.id_molde = $1
      `,
        [molde.id],
      );

      molde.maquinas = maquinasResult.rows;
    }

    res.status(200).json(moldes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar moldes" });
  }
});

app.post(
  "/moldes",
  autenticarToken,
  [
    body("codigo").notEmpty().withMessage("Código é obrigatório"),
    body("descricao").notEmpty().withMessage("Descrição é obrigatória"),
    body("maquinas").isArray().withMessage("Máquinas deve ser um array"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { codigo, descricao, id_maquina } = req.body;

    try {
      // Verifica se a máquina é injetora (se for informada)
      if (id_maquina) {
        const maquina = await pool.query(
          "SELECT tipo_maquina FROM maquinas WHERE id = $1",
          [id_maquina],
        );
        if (maquina.rows[0]?.tipo_maquina !== "INJETORA") {
          return res
            .status(400)
            .json({ message: "Apenas máquinas injetoras podem ter moldes" });
        }
      }

      const result = await pool.query(
        `INSERT INTO moldes (codigo, descricao, id_maquina) 
           VALUES ($1, $2, $3) RETURNING *`,
        [codigo, descricao, id_maquina || null],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(400).json({ message: "Código do molde já existe" });
      }
      console.error(err);
      res.status(500).json({ message: "Erro ao criar molde" });
    }
  },
);

// Rotas para Versões de Moldes
app.get("/moldes/:id/versoes", autenticarToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM moldes_versoes WHERE id_molde = $1 ORDER BY versao",
      [id],
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar versões do molde" });
  }
});

app.post(
  "/moldes/:id/versoes",
  autenticarToken,
  [body("versao").notEmpty().withMessage("Versão é obrigatória")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { versao } = req.body;

    try {
      const result = await pool.query(
        "INSERT INTO moldes_versoes (id_molde, versao) VALUES ($1, $2) RETURNING *",
        [id, versao],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res
          .status(400)
          .json({ message: "Já existe esta versão para este molde" });
      }
      console.error(err);
      res.status(500).json({ message: "Erro ao criar versão do molde" });
    }
  },
);

// Rotas para Produtos dos Moldes
app.get("/moldes/versoes/:id/produtos", autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT mp.id, mp.id_produto, mp.referencia_produto, 
             mp.descricao_produto, mp.cavidades
      FROM moldes_produtos mp
      WHERE mp.id_versao_molde = $1
      ORDER BY mp.id
    `,
      [id],
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar produtos" });
  }
});

// Atualizar cavidades usando o ID da associação (moldes_produtos.id)
app.put(
  "/moldes/produtos/:idAssociacao",
  autenticarToken,
  [body("cavidades").isInt().withMessage("Número de cavidades é obrigatório")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { idAssociacao } = req.params;
    const { cavidades } = req.body;

    try {
      const result = await pool.query(
        `UPDATE moldes_produtos 
       SET cavidades = $1 
       WHERE id = $2
       RETURNING *`,
        [cavidades, idAssociacao],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Associação não encontrada" });
      }

      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao atualizar cavidades" });
    }
  },
);

app.post(
  "/moldes/versoes/:id/produtos",
  autenticarToken,
  [
    body("id_produto")
      .optional()
      .isInt()
      .withMessage("ID do produto deve ser numérico"),
    body("referencia_produto").optional().isString(),
    body("descricao_produto").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { id_produto, referencia_produto, descricao_produto } = req.body;

    try {
      // Verificar se pelo menos um identificador de produto foi fornecido
      if (!id_produto && !referencia_produto) {
        return res
          .status(400)
          .json({ message: "Informe o ID ou a referência do produto" });
      }

      // Se id_produto foi fornecido, buscar informações do produto no banco AWORKS
      let produtoInfo = {};
      if (id_produto) {
        const produtoResult = await poolSeven.query(
          "SELECT referencia_produto, ds_produto FROM produtos WHERE id = $1",
          [id_produto],
        );
        if (produtoResult.rows.length > 0) {
          produtoInfo = {
            referencia_produto: produtoResult.rows[0].referencia_produto,
            descricao_produto: produtoResult.rows[0].ds_produto,
          };
        }
      }

      const result = await pool.query(
        `INSERT INTO moldes_produtos 
       (id_versao_molde, id_produto, referencia_produto, descricao_produto) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          id,
          id_produto || null,
          referencia_produto || produtoInfo.referencia_produto,
          descricao_produto || produtoInfo.descricao_produto,
        ],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(400).json({
          message: "Este produto já está associado a esta versão do molde",
        });
      }
      console.error(err);
      res.status(500).json({ message: "Erro ao adicionar produto ao molde" });
    }
  },
);

app.get("/moldes/:id/detalhes", async (req, res) => {
  try {
    const { id } = req.params;

    // Obter informações básicas do molde
    const moldeResult = await pool.query(
      `SELECT m.*, maq.descricao as maquina_descricao 
       FROM moldes m
       LEFT JOIN maquinas maq ON m.id_maquina = maq.id
       WHERE m.id = $1`,
      [id],
    );

    if (moldeResult.rows.length === 0) {
      return res.status(404).json({ message: "Molde não encontrado" });
    }

    const molde = moldeResult.rows[0];

    // Obter versões do molde com produtos e cavidades
    const versoesResult = await pool.query(
      `SELECT mv.*, 
       (
         SELECT json_agg(json_build_object(
           'id', mp.id,
           'id_produto', mp.id_produto,
           'referencia_produto', mp.referencia_produto,
           'descricao_produto', mp.descricao_produto,
           'cavidades', mp.cavidades
         ))
         FROM moldes_produtos mp
         WHERE mp.id_versao_molde = mv.id
       ) as produtos
       FROM moldes_versoes mv
       WHERE mv.id_molde = $1
       ORDER BY mv.versao`,
      [id],
    );

    molde.versoes = versoesResult.rows;

    res.status(200).json(molde);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar detalhes do molde" });
  }
});

// Rota para adicionar produto a versão do molde com cavidades
app.post(
  "/moldes/versoes/:id/produtos",
  autenticarToken,
  [
    body("id_produto").optional().isInt(),
    body("referencia_produto").optional().isString(),
    body("descricao_produto").optional().isString(),
    body("cavidades").isInt().withMessage("Número de cavidades é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { id_produto, referencia_produto, descricao_produto, cavidades } =
      req.body;

    try {
      // Verificar se já existe o produto nesta versão
      const existe = await pool.query(
        "SELECT id FROM moldes_produtos WHERE id_versao_molde = $1 AND (id_produto = $2 OR referencia_produto = $3)",
        [id, id_produto, referencia_produto],
      );

      if (existe.rows.length > 0) {
        return res.status(400).json({
          message: "Produto já está associado a esta versão do molde",
        });
      }

      // Se id_produto foi fornecido, buscar informações do produto no banco AWORKS
      let produtoInfo = {};
      if (id_produto) {
        const produtoResult = await poolSeven.query(
          "SELECT referencia_produto, ds_produto FROM produtos WHERE id = $1",
          [id_produto],
        );
        if (produtoResult.rows.length > 0) {
          produtoInfo = {
            referencia_produto: produtoResult.rows[0].referencia_produto,
            descricao_produto: produtoResult.rows[0].ds_produto,
          };
        }
      }

      // Inserir o produto com número de cavidades
      const result = await pool.query(
        `INSERT INTO moldes_produtos 
       (id_versao_molde, id_produto, referencia_produto, descricao_produto, cavidades) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          id,
          id_produto || null,
          referencia_produto || produtoInfo.referencia_produto,
          descricao_produto || produtoInfo.descricao_produto,
          cavidades,
        ],
      );

      // Atualizar o total de cavidades do molde
      await pool.query(
        `UPDATE moldes 
       SET cavidades = (
         SELECT SUM(mp.cavidades) 
         FROM moldes_produtos mp
         JOIN moldes_versoes mv ON mp.id_versao_molde = mv.id
         WHERE mv.id_molde = $1
       )
       WHERE id = $1`,
        [id],
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(400).json({
          message: "Este produto já está associado a esta versão do molde",
        });
      }
      console.error(err);
      res.status(500).json({ message: "Erro ao adicionar produto ao molde" });
    }
  },
);

// Rota para atualizar cavidades de um produto na versão do molde
app.put(
  "/moldes/versoes/:idVersao/produtos/:idProduto",
  autenticarToken,
  [body("cavidades").isInt().withMessage("Número de cavidades é obrigatório")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { idVersao, idProduto } = req.params;
    const { cavidades } = req.body;

    try {
      // Atualizar as cavidades do produto
      const result = await pool.query(
        `UPDATE moldes_produtos 
       SET cavidades = $1 
       WHERE id_versao_molde = $2 AND id_produto = $3
       RETURNING *`,
        [cavidades, idVersao, idProduto],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ message: "Produto não encontrado nesta versão" });
      }

      // Obter o ID do molde para atualizar o total de cavidades
      const moldeResult = await pool.query(
        `SELECT id_molde FROM moldes_versoes WHERE id = $1`,
        [idVersao],
      );

      if (moldeResult.rows.length > 0) {
        const idMolde = moldeResult.rows[0].id_molde;

        // Atualizar o total de cavidades do molde
        await pool.query(
          `UPDATE moldes 
         SET cavidades = (
           SELECT SUM(mp.cavidades) 
           FROM moldes_produtos mp
           JOIN moldes_versoes mv ON mp.id_versao_molde = mv.id
           WHERE mv.id_molde = $1
         )
         WHERE id = $1`,
          [idMolde],
        );
      }

      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Erro ao atualizar cavidades do produto" });
    }
  },
);

// Rota para listar moldes com informações básicas
app.get("/moldes", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, maq.descricao as maquina_descricao 
      FROM moldes m
      LEFT JOIN maquinas maq ON m.id_maquina = maq.id
      WHERE (maq.tipo_maquina = 'INJETORA' OR m.id_maquina IS NULL)
      ORDER BY m.codigo
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar moldes" });
  }
});

// Rota para criar/atualizar molde com múltiplas máquinas
app.post(
  "/moldes",
  autenticarToken,
  [
    body("codigo").notEmpty().withMessage("Código é obrigatório"),
    body("descricao").notEmpty().withMessage("Descrição é obrigatória"),
    body("maquinas").isArray().withMessage("Máquinas deve ser um array"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { codigo, descricao, maquinas, observacoes } = req.body;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Criar o molde
      const moldeResult = await client.query(
        `INSERT INTO moldes (codigo, descricao, observacoes) 
       VALUES ($1, $2, $3) RETURNING *`,
        [codigo, descricao, observacoes || null],
      );

      const molde = moldeResult.rows[0];

      // 2. Vincular máquinas
      if (maquinas && maquinas.length > 0) {
        // Verificar se são máquinas injetoras
        const maquinasResult = await client.query(
          "SELECT id FROM maquinas WHERE id = ANY($1) AND tipo_maquina = $2",
          [maquinas, "INJETORA"],
        );

        if (maquinasResult.rows.length !== maquinas.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            message: "Apenas máquinas injetoras podem ser vinculadas",
          });
        }

        // Inserir relações
        for (const id_maquina of maquinas) {
          await client.query(
            "INSERT INTO moldes_maquinas (id_molde, id_maquina) VALUES ($1, $2)",
            [molde.id, id_maquina],
          );
        }
      }

      await client.query("COMMIT");
      res.status(201).json(molde);
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") {
        return res.status(400).json({ message: "Código do molde já existe" });
      }
      console.error(err);
      res.status(500).json({ message: "Erro ao criar molde" });
    } finally {
      client.release();
    }
  },
);

// Rota para obter moldes com máquinas vinculadas
app.get("/moldes", autenticarToken, async (req, res) => {
  try {
    const moldesResult = await pool.query(`
      SELECT m.* FROM moldes m ORDER BY m.codigo
    `);

    const moldes = moldesResult.rows;

    // Obter máquinas para cada molde
    for (const molde of moldes) {
      const maquinasResult = await pool.query(
        `
        SELECT maq.* FROM maquinas maq
        JOIN moldes_maquinas mm ON maq.id = mm.id_maquina
        WHERE mm.id_molde = $1
      `,
        [molde.id],
      );

      molde.maquinas = maquinasResult.rows;
    }

    res.status(200).json(moldes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar moldes" });
  }
});

// Rota para salvar operadores
app.post(
  "/operadores",
  autenticarToken,
  [
    body("nome").notEmpty().withMessage("Nome é obrigatório"),
    body("email")
      .if(body("email").exists({ checkFalsy: true }))
      .isEmail()
      .withMessage("Email inválido"),
    body("senha")
      .isLength({ min: 4 })
      .withMessage("Senha deve ter pelo menos 4 caracteres"),
    body("turno")
      .isIn(["Turno A", "Turno B", "Turno C"])
      .withMessage("Turno inválido"),
    body("tipoOperador")
      .isIn(["Montagem/Embalagem", "Injetoras", "Gestão", "Expedição", "Desligado"])
      .withMessage("Tipo de operador inválido"),
  ],
  async (req, res) => {
    if (!podeGerenciarOperadores(req.user)) {
      return res.status(403).json({
        message: "Acesso negado: apenas perfis autorizados podem cadastrar operadores",
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nome, email, senha, turno, tipoOperador, administrador, cargo, telefone, fotoUrl } = req.body;
    const fotoUrlNormalizada = normalizarFotoUrlOperador(fotoUrl);

    try {
      // Converte o nome para caixa alta
      const nomeUpperCase = nome.toUpperCase();

      // Verifica se já existe um operador com o mesmo nome
      const operadorExistente = await pool.query(
        "SELECT * FROM operadores WHERE nome = $1",
        [nomeUpperCase],
      );

      if (operadorExistente.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Já existe um operador com esse nome" });
      }

      const senhaHash = await gerarHashSenha(senha);

      // Insere o novo operador no banco de dados
      const result = await pool.query(
        "INSERT INTO operadores (nome, email, senha, turno, tipo_operador, administrador, cargo, telefone, foto_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        [nomeUpperCase, email || null, senhaHash, turno, tipoOperador, administrador === true, cargo || null, telefone || null, fotoUrlNormalizada || null],
      );

      res.status(201).json(sanitizeOperador(result.rows[0]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao salvar operador" });
    }
  },
);

//Rota para editar operadores
app.put(
  "/operadores/:id",
  autenticarToken,
  [
    body("nome").optional().notEmpty().withMessage("Nome é obrigatório"),
    body("email")
      .if(body("email").exists({ checkFalsy: true }))
      .isEmail()
      .withMessage("Email inválido"),
    body("senha")
      .if(body("senha").exists({ checkFalsy: true }))
      .isLength({ min: 4 })
      .withMessage("Senha deve ter pelo menos 4 caracteres"),
    body("turno")
      .optional()
      .isIn(["Turno A", "Turno B", "Turno C"])
      .withMessage("Turno inválido"),
    body("tipoOperador")
      .optional()
      .isIn(["Montagem/Embalagem", "Injetoras", "Gestão", "Expedição", "Desligado"])
      .withMessage("Tipo de operador inválido"),
  ],
  async (req, res) => {
    if (!podeGerenciarOperadores(req.user)) {
      return res.status(403).json({
        message: "Acesso negado: apenas perfis autorizados podem editar operadores",
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { nome, email, senha, turno, tipoOperador, administrador, cargo, telefone, fotoUrl } = req.body;
    const fotoUrlNormalizada = normalizarFotoUrlOperador(fotoUrl);

    try {
      const nomeUpperCase = nome ? nome.toUpperCase() : null;
      const senhaHash = senha ? await gerarHashSenha(senha) : null;

      const result = await pool.query(
        "UPDATE operadores SET nome = COALESCE($1, nome), email = COALESCE($2, email), senha = COALESCE($3, senha), turno = COALESCE($4, turno), tipo_operador = COALESCE($5, tipo_operador), administrador = COALESCE($6, administrador), cargo = COALESCE($7, cargo), telefone = COALESCE($8, telefone), foto_url = COALESCE($9, foto_url) WHERE id = $10 RETURNING *",
        [nomeUpperCase, email, senhaHash, turno, tipoOperador, typeof administrador === "boolean" ? administrador : null, cargo, telefone, fotoUrlNormalizada, id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Operador não encontrado" });
      }

      res.status(200).json(sanitizeOperador(result.rows[0]));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao editar operador" });
    }
  },
);

//Rota para listar operadores
app.get("/operadores/listar", autenticarToken, async (req, res) => {
  const {
    page = 1,
    limit = 10,
    busca = "",
    turno = "",
    tipoOperador = "",
    status = "todos",
  } = req.query;
  const currentPage = parseInt(page, 10) || 1;
  const pageSize = parseInt(limit, 10) || 10;
  const offset = (currentPage - 1) * pageSize;

  try {
    if (!podeGerenciarOperadores(req.user)) {
      return res.status(403).json({
        message: "Acesso negado: apenas perfis autorizados podem listar operadores",
      });
    }

    const filtros = [];
    const params = [];

    if (String(busca).trim()) {
      params.push(`%${String(busca).trim().toUpperCase()}%`);
      filtros.push(`nome LIKE $${params.length}`);
    }

    if (String(turno).trim()) {
      params.push(String(turno).trim());
      filtros.push(`turno = $${params.length}`);
    }

    if (String(tipoOperador).trim()) {
      params.push(String(tipoOperador).trim());
      filtros.push(`tipo_operador = $${params.length}`);
    }

    if (status === "ativos") {
      params.push("Desligado");
      filtros.push(`tipo_operador <> $${params.length}`);
    }

    if (status === "desligados") {
      params.push("Desligado");
      filtros.push(`tipo_operador = $${params.length}`);
    }

    const whereClause = filtros.length > 0 ? `WHERE ${filtros.join(" AND ")}` : "";

    // Consulta para obter os operadores paginados
    params.push(pageSize);
    params.push(offset);
    const result = await pool.query(
      `SELECT id, nome, email, administrador, turno, tipo_operador, data_cadastro, cargo, telefone, foto_url
       FROM operadores
       ${whereClause}
       ORDER BY nome
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    // Consulta para contar o total de operadores
    const totalResult = await pool.query(
      `SELECT COUNT(*) as total FROM operadores ${whereClause}`,
      params.slice(0, params.length - 2),
    );
    const total = parseInt(totalResult.rows[0].total);

    const operadoresNormalizados = result.rows.map((operador) => ({
      ...operador,
      foto_url: normalizarFotoUrlOperador(operador.foto_url),
    }));

    res.status(200).json({
      operadores: operadoresNormalizados,
      total,
      page: currentPage,
      limit: pageSize,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao listar operadores" });
  }
});

app.get("/operadores/me", autenticarToken, async (req, res) => {
  try {
    const operador = await buscarOperadorSeguroPorId(req.user.id);

    if (!operador) {
      return res.status(404).json({ message: "Operador não encontrado" });
    }

    res.status(200).json(operador);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao carregar perfil do operador" });
  }
});

app.put("/operadores/me", autenticarToken, async (req, res) => {
  const { email, turno, cargo, telefone, fotoUrl } = req.body;
  const fotoUrlNormalizada = normalizarFotoUrlOperador(fotoUrl);

  try {
    const result = await pool.query(
      `UPDATE operadores
       SET email = COALESCE($1, email),
           turno = COALESCE($2, turno),
           cargo = COALESCE($3, cargo),
           telefone = COALESCE($4, telefone),
           foto_url = COALESCE($5, foto_url)
       WHERE id = $6
       RETURNING *`,
      [email, turno, cargo, telefone, fotoUrlNormalizada, req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Operador não encontrado" });
    }

    res.status(200).json(sanitizeOperador(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao atualizar perfil do operador" });
  }
});

app.put("/operadores/me/senha", autenticarToken, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ message: "Senha atual e nova senha são obrigatórias" });
  }

  if (typeof novaSenha !== "string" || novaSenha.length < 4) {
    return res.status(400).json({ message: "A nova senha deve ter no mínimo 4 caracteres" });
  }

  try {
    const result = await pool.query("SELECT * FROM operadores WHERE id = $1", [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Operador não encontrado" });
    }

    const operador = result.rows[0];
    const senhaValida = await validarSenhaOperador(operador, senhaAtual);

    if (!senhaValida) {
      return res.status(400).json({ message: "Senha atual inválida" });
    }

    const novaSenhaHash = await gerarHashSenha(novaSenha);
    await pool.query("UPDATE operadores SET senha = $1 WHERE id = $2", [novaSenhaHash, req.user.id]);

    return res.status(200).json({ message: "Senha alterada com sucesso" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erro ao alterar senha" });
  }
});

// Rota para verificar se há inventário aberto (para Expedição)
app.get("/operadores/verificar/inventario-aberto", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as total FROM inventario WHERE status = $1",
      ["aberto"]
    );
    const temInventarioAberto = parseInt(result.rows[0].total) > 0;
    
    res.status(200).json({
      temInventarioAberto,
      total: parseInt(result.rows[0].total)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao verificar inventário" });
  }
});

// Rota para obter permissões de menu por tipo de operador
app.get("/operadores/:id/permissoes-menu", autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Buscar o tipo_operador
    const operadorResult = await pool.query(
      "SELECT tipo_operador FROM operadores WHERE id = $1",
      [id]
    );
    
    if (operadorResult.rows.length === 0) {
      return res.status(404).json({ message: "Operador não encontrado" });
    }
    
    const tipoOperador = operadorResult.rows[0].tipo_operador;
    
    // Se for Expedição, verificar se há inventário aberto
    if (tipoOperador === "Expedição") {
      const inventarioResult = await pool.query(
        "SELECT COUNT(*) as total FROM inventario WHERE status = $1",
        ["aberto"]
      );
      const temInventarioAberto = parseInt(inventarioResult.rows[0].total) > 0;
      
      return res.status(200).json({
        tipoOperador,
        temInventarioAberto,
        menuPermissions: {
          podeVerDashboardContagem: true,
          podeVerContagemEstoque: temInventarioAberto,
          podeVerEntradaProducao: true,
          podeVerListaSeparacao: true
        }
      });
    }
    
    // Para outros tipos de operador, retornar permissões padrão (todos os menus)
    res.status(200).json({
      tipoOperador,
      temInventarioAberto: false,
      menuPermissions: {
        todosMenus: true
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar permissões" });
  }
});

// Rota para listar máquinas (com autenticação)
app.get("/maquinas", autenticarToken, async (req, res) => {
  try {
    const { tipo } = req.query;

    let query =
      "SELECT id, descricao, tipo_maquina FROM maquinas WHERE ativo = true";
    const params = [];

    if (tipo) {
      query += " AND tipo_maquina = $1";
      params.push(tipo);
    }

    query += " ORDER BY descricao";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar máquinas" });
    error: err.message;
  }
});

// Rota para salvar máquinas
app.post(
  "/maquinas",
  autenticarToken,
  [
    body("descricao").notEmpty().withMessage("Descrição é obrigatória"),
    body("tipo_maquina")
      .notEmpty()
      .withMessage("Tipo de máquina é obrigatório"),
    body("data_aquisicao").optional().isISO8601().withMessage("Data inválida"),
    body("quantidade_operadores")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Quantidade deve ser pelo menos 1"),
    body("exige_iniciar_operacao").optional().isBoolean(),
    body("considera_qualidade").optional().isBoolean(),
    body("considera_eficiencia").optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      descricao,
      tipo_maquina,
      data_aquisicao,
      quantidade_operadores = 1,
      exige_iniciar_operacao = false,
      considera_qualidade = false,
      considera_eficiencia = false,
    } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO maquinas (
        descricao, 
        tipo_maquina, 
        data_aquisicao, 
        quantidade_operadores, 
        exige_iniciar_operacao, 
        considera_qualidade, 
        considera_eficiencia
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *`,
        [
          descricao,
          tipo_maquina,
          data_aquisicao || null,
          quantidade_operadores,
          exige_iniciar_operacao,
          considera_qualidade,
          considera_eficiencia,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);

      if (err.code === "23505") {
        return res.status(400).json({
          message: "Já existe uma máquina com esta descrição",
        });
      }

      res.status(500).json({
        message: "Erro ao salvar máquina",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
);

// Rota para atualizar máquina (nova implementação)
app.put(
  "/maquinas/:id",
  autenticarToken,
  [
    body("descricao").optional().notEmpty(),
    body("tipo_maquina").optional().notEmpty(),
    body("data_aquisicao").optional().isISO8601(),
    body("quantidade_operadores").optional().isInt({ min: 1 }),
    body("exige_iniciar_operacao").optional().isBoolean(),
    body("considera_qualidade").optional().isBoolean(),
    body("considera_eficiencia").optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const updateFields = req.body;

    try {
      // Verifica se a máquina existe
      const existe = await pool.query("SELECT id FROM maquinas WHERE id = $1", [
        id,
      ]);
      if (existe.rows.length === 0) {
        return res.status(404).json({ message: "Máquina não encontrada" });
      }

      // Monta a query dinamicamente
      const setClauses = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updateFields)) {
        if (value !== undefined) {
          setClauses.push(`${key} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setClauses.length === 0) {
        return res
          .status(400)
          .json({ message: "Nenhum campo válido para atualização" });
      }

      values.push(id); // Adiciona o ID como último parâmetro

      const query = `
      UPDATE maquinas
      SET ${setClauses.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

      const result = await pool.query(query, values);
      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error(err);

      if (err.code === "23505") {
        return res.status(400).json({
          message: "Já existe uma máquina com esta descrição",
        });
      }

      res.status(500).json({
        message: "Erro ao atualizar máquina",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
);

// 🔹 ROTA PARA OBTER TOTAL DE PRODUTOS (COM FILTRO DE BUSCA) - COM /api - DEVE VIR ANTES!
app.get("/api/produtos-cadastro/total", async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT COUNT(*) as total
      FROM produtos p
      WHERE 1=1
    `;

    const params = [];

    // Filtro de busca
    if (search) {
      query += ` AND (p.referencia_produto ILIKE $${params.length + 1} OR p.ds_produto ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    const result = await pool.query(query, params);
    const total = parseInt(result.rows[0].total, 10);

    res.json({ total });
  } catch (error) {
    console.error("Erro ao buscar total de produtos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/produtos-cadastro", async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;

    let query = `
      SELECT 
        p.*,
        uc.codigo as unidade_compra_codigo,
        ucon.codigo as unidade_consumo_codigo
      FROM produtos p
      LEFT JOIN unidades uc ON p.id_unidade_compra = uc.id
      LEFT JOIN unidades ucon ON p.id_unidade_consumo = ucon.id
      WHERE 1=1
    `;

    const params = [];

    // Filtro de busca
    if (search) {
      query += ` AND (p.referencia_produto ILIKE $${params.length + 1} OR p.ds_produto ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    // Ordenação e paginação
    query += ` ORDER BY p.referencia_produto LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// ✅ ROTA SEM /api para proxy reverso do Apache
// 🔹 ROTA PARA OBTER TOTAL DE PRODUTOS (COM FILTRO DE BUSCA) - DEVE VIR ANTES!
app.get("/produtos-cadastro/total", async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT COUNT(*) as total
      FROM produtos p
      WHERE 1=1
    `;

    const params = [];

    // Filtro de busca
    if (search) {
      query += ` AND (p.referencia_produto ILIKE $${params.length + 1} OR p.ds_produto ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    const result = await pool.query(query, params);
    const total = parseInt(result.rows[0].total, 10);

    res.json({ total });
  } catch (error) {
    console.error("Erro ao buscar total de produtos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// ✅ ROTA SEM /api para proxy reverso do Apache
app.get("/produtos-cadastro", async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;

    let query = `
      SELECT 
        p.*,
        uc.codigo as unidade_compra_codigo,
        ucon.codigo as unidade_consumo_codigo
      FROM produtos p
      LEFT JOIN unidades uc ON p.id_unidade_compra = uc.id
      LEFT JOIN unidades ucon ON p.id_unidade_consumo = ucon.id
      WHERE 1=1
    `;

    const params = [];

    // Filtro de busca
    if (search) {
      query += ` AND (p.referencia_produto ILIKE $${params.length + 1} OR p.ds_produto ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    // Ordenação e paginação
    query += ` ORDER BY p.referencia_produto LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// 🔹 ROTA PARA OBTER TOTAL DE PRODUTOS (COM FILTRO DE BUSCA)
app.get("/produtos-cadastro/total", async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT COUNT(*) as total
      FROM produtos p
      WHERE 1=1
    `;

    const params = [];

    // Filtro de busca
    if (search) {
      query += ` AND (p.referencia_produto ILIKE $${params.length + 1} OR p.ds_produto ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    const result = await pool.query(query, params);
    const total = parseInt(result.rows[0].total, 10);

    res.json({ total });
  } catch (error) {
    console.error("Erro ao buscar total de produtos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota para criar produto (cadastro)
app.post(
  "/api/produtos-cadastro",
  [
    body("referencia_produto")
      .notEmpty()
      .withMessage("Referência é obrigatória"),
    body("ds_produto").notEmpty().withMessage("Descrição é obrigatória"),
  ],
  async (req, res) => {
    // ... implementação igual à anterior, mas na rota /api/produtos-cadastro
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const {
        referencia_produto,
        ds_produto,
        ean13,
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        pecas_por_ciclo,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
      } = req.body;

      // Verificar se referência já existe
      const referenciaExistente = await client.query(
        "SELECT id FROM produtos WHERE referencia_produto = $1",
        [referencia_produto],
      );

      if (referenciaExistente.rows.length > 0) {
        return res.status(400).json({
          error: "Já existe um produto com esta referência",
        });
      }

      // Inserir produto
      const result = await client.query(
        `
      INSERT INTO produtos (
        referencia_produto, ds_produto, ean13, id_unidade_compra, id_unidade_consumo,
        fator_conversao_compra_consumo, tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos, tempo_padrao_injecao_segundos,
        pecas_por_ciclo, meta_horaria_montagem, meta_horaria_embalagem,
        meta_horaria_injecao, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *
    `,
        [
          referencia_produto,
          ds_produto,
          ean13 || null,
          id_unidade_compra,
          id_unidade_consumo,
          fator_conversao_compra_consumo || 1,
          tempo_padrao_montagem_segundos || null,
          tempo_padrao_embalagem_segundos || null,
          tempo_padrao_injecao_segundos || null,
          pecas_por_ciclo || null,
          meta_horaria_montagem || null,
          meta_horaria_embalagem || null,
          meta_horaria_injecao || null,
        ],
      );

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        produto: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao criar produto:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    } finally {
      client.release();
    }
  },
);

// ✅ Rota para criar produto SEM /api (para proxy reverso Apache)
app.post(
  "/produtos-cadastro",
  [
    body("referencia_produto")
      .notEmpty()
      .withMessage("Referência é obrigatória"),
    body("ds_produto").notEmpty().withMessage("Descrição é obrigatória"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const {
        referencia_produto,
        ds_produto,
        ean13,
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        pecas_por_ciclo,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
      } = req.body;

      const referenciaExistente = await client.query(
        "SELECT id FROM produtos WHERE referencia_produto = $1",
        [referencia_produto],
      );

      if (referenciaExistente.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Já existe um produto com esta referência",
        });
      }

      const result = await client.query(
        `
      INSERT INTO produtos (
        referencia_produto, ds_produto, ean13, id_unidade_compra, id_unidade_consumo,
        fator_conversao_compra_consumo, tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos, tempo_padrao_injecao_segundos,
        pecas_por_ciclo, meta_horaria_montagem, meta_horaria_embalagem,
        meta_horaria_injecao, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *
    `,
        [
          referencia_produto,
          ds_produto,
          ean13 || null,
          id_unidade_compra,
          id_unidade_consumo,
          fator_conversao_compra_consumo || 1,
          tempo_padrao_montagem_segundos || null,
          tempo_padrao_embalagem_segundos || null,
          tempo_padrao_injecao_segundos || null,
          pecas_por_ciclo || null,
          meta_horaria_montagem || null,
          meta_horaria_embalagem || null,
          meta_horaria_injecao || null,
        ],
      );

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        produto: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao criar produto:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    } finally {
      client.release();
    }
  },
);

// Rota para atualizar produto (cadastro)
app.put(
  "/api/produtos-cadastro/:id",
  [
    body("referencia_produto")
      .notEmpty()
      .withMessage("Referência é obrigatória"),
    body("ds_produto").notEmpty().withMessage("Descrição é obrigatória"),
  ],
  async (req, res) => {
    // ... implementação igual à anterior, mas na rota /api/produtos-cadastro
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const client = await pool.connect();
    const produtoId = req.params.id;

    try {
      await client.query("BEGIN");

      const {
        referencia_produto,
        ds_produto,
        ean13,
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        pecas_por_ciclo,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
      } = req.body;

      // Verificar se produto existe
      const produtoExistente = await client.query(
        "SELECT id FROM produtos WHERE id = $1",
        [produtoId],
      );

      if (produtoExistente.rows.length === 0) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      // Atualizar produto
      const result = await client.query(
        `
      UPDATE produtos SET
        referencia_produto = $1,
        ds_produto = $2,
        ean13 = $3,
        id_unidade_compra = $4,
        id_unidade_consumo = $5,
        fator_conversao_compra_consumo = $6,
        tempo_padrao_montagem_segundos = $7,
        tempo_padrao_embalagem_segundos = $8,
        tempo_padrao_injecao_segundos = $9,
        pecas_por_ciclo = $10,
        meta_horaria_montagem = $11,
        meta_horaria_embalagem = $12,
        meta_horaria_injecao = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `,
        [
          referencia_produto,
          ds_produto,
          ean13 || null,
          id_unidade_compra,
          id_unidade_consumo,
          fator_conversao_compra_consumo || 1,
          tempo_padrao_montagem_segundos || null,
          tempo_padrao_embalagem_segundos || null,
          tempo_padrao_injecao_segundos || null,
          pecas_por_ciclo || null,
          meta_horaria_montagem || null,
          meta_horaria_embalagem || null,
          meta_horaria_injecao || null,
          produtoId,
        ],
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        produto: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao atualizar produto:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    } finally {
      client.release();
    }
  },
);

// ✅ Rota para atualizar produto SEM /api (para proxy reverso Apache)
app.put(
  "/produtos-cadastro/:id",
  [
    body("referencia_produto")
      .notEmpty()
      .withMessage("Referência é obrigatória"),
    body("ds_produto").notEmpty().withMessage("Descrição é obrigatória"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const client = await pool.connect();
    const produtoId = req.params.id;

    try {
      await client.query("BEGIN");

      const {
        referencia_produto,
        ds_produto,
        ean13,
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        pecas_por_ciclo,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
      } = req.body;

      const produtoExistente = await client.query(
        "SELECT id FROM produtos WHERE id = $1",
        [produtoId],
      );

      if (produtoExistente.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      const result = await client.query(
        `
      UPDATE produtos SET
        referencia_produto = $1,
        ds_produto = $2,
        ean13 = $3,
        id_unidade_compra = $4,
        id_unidade_consumo = $5,
        fator_conversao_compra_consumo = $6,
        tempo_padrao_montagem_segundos = $7,
        tempo_padrao_embalagem_segundos = $8,
        tempo_padrao_injecao_segundos = $9,
        pecas_por_ciclo = $10,
        meta_horaria_montagem = $11,
        meta_horaria_embalagem = $12,
        meta_horaria_injecao = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *
    `,
        [
          referencia_produto,
          ds_produto,
          ean13 || null,
          id_unidade_compra,
          id_unidade_consumo,
          fator_conversao_compra_consumo || 1,
          tempo_padrao_montagem_segundos || null,
          tempo_padrao_embalagem_segundos || null,
          tempo_padrao_injecao_segundos || null,
          pecas_por_ciclo || null,
          meta_horaria_montagem || null,
          meta_horaria_embalagem || null,
          meta_horaria_injecao || null,
          produtoId,
        ],
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        produto: result.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao atualizar produto:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    } finally {
      client.release();
    }
  },
);

// Rota para validar referência única (cadastro)
app.get("/api/produtos-cadastro/validar-referencia", async (req, res) => {
  try {
    const { referencia, excluir_id } = req.query;

    if (!referencia) {
      return res.json({ valido: true });
    }

    let query = "SELECT id FROM produtos WHERE referencia_produto = $1";
    const params = [referencia];

    if (excluir_id) {
      query += " AND id != $2";
      params.push(excluir_id);
    }

    const result = await pool.query(query, params);

    res.json({
      valido: result.rows.length === 0,
      mensagem:
        result.rows.length > 0 ? "Referência já está em uso" : undefined,
    });
  } catch (error) {
    console.error("Erro ao validar referência:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// ✅ Rota para validar referência SEM /api (para proxy reverso Apache)
app.get("/produtos-cadastro/validar-referencia", async (req, res) => {
  try {
    const { referencia, excluir_id } = req.query;

    if (!referencia) {
      return res.json({ valido: true });
    }

    let query = "SELECT id FROM produtos WHERE referencia_produto = $1";
    const params = [referencia];

    if (excluir_id) {
      query += " AND id != $2";
      params.push(excluir_id);
    }

    const result = await pool.query(query, params);

    res.json({
      valido: result.rows.length === 0,
      mensagem:
        result.rows.length > 0 ? "Referência já está em uso" : undefined,
    });
  } catch (error) {
    console.error("Erro ao validar referência:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota para validar EAN único (cadastro)
app.get("/api/produtos-cadastro/validar-ean", async (req, res) => {
  try {
    const { ean13, excluir_id } = req.query;

    if (!ean13) {
      return res.json({ valido: true });
    }

    let query =
      "SELECT id FROM produtos WHERE ean13 = $1 AND ean13 IS NOT NULL";
    const params = [ean13];

    if (excluir_id) {
      query += " AND id != $2";
      params.push(excluir_id);
    }

    const result = await pool.query(query, params);

    res.json({
      valido: result.rows.length === 0,
      mensagem: result.rows.length > 0 ? "EAN13 já está em uso" : undefined,
    });
  } catch (error) {
    console.error("Erro ao validar EAN13:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota para excluir produto (cadastro)
app.delete("/api/produtos-cadastro/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const produtoId = req.params.id;

    // Verificar se produto existe
    const produtoExistente = await client.query(
      "SELECT id FROM produtos WHERE id = $1",
      [produtoId],
    );

    if (produtoExistente.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    // Excluir produto
    await client.query("DELETE FROM produtos WHERE id = $1", [produtoId]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Produto excluído com sucesso",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao excluir produto:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  } finally {
    client.release();
  }
});

// Rota para buscar produto por ID (cadastro)
app.get("/api/produtos-cadastro/:id", async (req, res) => {
  try {
    const produtoId = req.params.id;

    const result = await pool.query(
      `
      SELECT 
        p.*,
        uc.codigo as unidade_compra_codigo,
        ucon.codigo as unidade_consumo_codigo
      FROM produtos p
      LEFT JOIN unidades uc ON p.id_unidade_compra = uc.id
      LEFT JOIN unidades ucon ON p.id_unidade_consumo = ucon.id
      WHERE p.id = $1
    `,
      [produtoId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    res.json({
      success: true,
      produto: result.rows[0],
    });
  } catch (error) {
    console.error("Erro ao buscar produto:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota para buscar produtos
app.get("/produtos", async (req, res) => {
  const { limit, offset, tp_produto } = req.query;

  try {
    let query = "SELECT id, referencia_produto, ds_produto, tp_produto FROM produtos WHERE 1=1";
    const params = [];

    if (tp_produto) {
      params.push(tp_produto);
      query += ` AND tp_produto = $${params.length}`;
    }

    if (limit && offset) {
      query += ` LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
    }

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar produtos" });
  }
});

// Rota para contar o total de produtos
app.get("/produtos/total", async (req, res) => {
  try {
    const result = await pool.query("SELECT COUNT(*) as total FROM produtos");
    res.status(200).json({ total: parseInt(result.rows[0].total) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao contar produtos" });
  }
});

// Rota para iniciar apontamento
app.post(
  "/apontamento/iniciar",
  autenticarToken,
  [
    body("id_operador").isNumeric().withMessage("ID do operador é obrigatório"),
    body("id_maquina").isNumeric().withMessage("ID da máquina é obrigatório"),
    body("id_ordem_producao")
      .notEmpty()
      .withMessage("ID da ordem de produção é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await registrarLog("ERRO", "Validação falhou ao iniciar apontamento", {
        errors: errors.array(),
      });
      return res.status(400).json({ errors: errors.array() });
    }

    const client = await pool.connect(); // Usar client para transação
    const { id_operador, id_maquina, id_ordem_producao } = req.body;

    try {
      await client.query("BEGIN"); // Iniciar transação

      // 1. VALIDAÇÃO DA ORDEM DE PRODUÇÃO (MANTIDO ORIGINAL)
      const ordemResult = await client.query(
        "SELECT id_produto, quantidade FROM ordem_producao WHERE id = $1",
        [id_ordem_producao],
      );

      if (ordemResult.rows.length === 0) {
        await client.query("ROLLBACK");
        await registrarLog(
          "ERRO",
          "Ordem de produção não encontrada",
          { id_ordem_producao },
          null,
          id_operador,
        );
        return res
          .status(404)
          .json({ message: "Ordem de produção não encontrada" });
      }

      const { id_produto, quantidade } = ordemResult.rows[0];

      // 2. VERIFICAR SE EXISTE APONTAMENTO AUTOMÁTICO (NOVA FUNCIONALIDADE)
      let quantidadeTransferida = 0;
      let idApontamentoAutomatico = null;

      const apontamentoAutomaticoResult = await client.query(
        `SELECT id, quantidade_pecas 
         FROM apontamento_producao 
         WHERE id_maquina = $1 
         AND status = 'EM_ANDAMENTO' 
         AND origem_automatica = true
         ORDER BY data_inicio DESC 
         LIMIT 1`,
        [id_maquina],
      );

      // 3. SE EXISTIR APONTAMENTO AUTOMÁTICO, TRANSFERIR
      if (apontamentoAutomaticoResult.rows.length > 0) {
        idApontamentoAutomatico = apontamentoAutomaticoResult.rows[0].id;
        quantidadeTransferida =
          apontamentoAutomaticoResult.rows[0].quantidade_pecas || 0;

        // Finalizar o apontamento automático
        await client.query(
          `UPDATE apontamento_producao 
           SET status = 'FINALIZADO', 
               data_fim = NOW(),
               motivo_transferencia = 'Transferido para apontamento manual - OP: ${id_ordem_producao}'
           WHERE id = $1`,
          [idApontamentoAutomatico],
        );

        await registrarLog(
          "TRANSFERENCIA",
          `Apontamento automático finalizado e transferido: ${quantidadeTransferida} peças`,
          {
            id_apontamento_automatico: idApontamentoAutomatico,
            quantidade_transferida: quantidadeTransferida,
          },
          null,
          id_operador,
        );
      }

      // 4. CRIAR NOVO APONTAMENTO (MANTIDO ORIGINAL COM PEÇAS TRANSFERIDAS)
      const result = await client.query(
        `INSERT INTO apontamento_producao 
         (id_operador, id_maquina, id_produto, id_ordem_producao, data_inicio, status, quantidade_pecas) 
         VALUES ($1, $2, $3, $4, NOW(), $5, $6) 
         RETURNING *`,
        [
          id_operador,
          id_maquina,
          id_produto,
          id_ordem_producao,
          "EM_ANDAMENTO",
          quantidadeTransferida,
        ],
      );

      // 5. ATUALIZAR STATUS DA ORDEM (MANTIDO ORIGINAL)
      await client.query(
        "UPDATE ordem_producao SET status = $1 WHERE id = $2",
        ["EM_ANDAMENTO", id_ordem_producao],
      );

      // 6. SE HOUVE TRANSFERÊNCIA, MOVER OS PULSOS TAMBÉM
      if (quantidadeTransferida > 0 && idApontamentoAutomatico) {
        await client.query(
          `UPDATE apontamento_pulsos 
           SET id_apontamento = $1, id_operador = $2
           WHERE id_apontamento = $3`,
          [result.rows[0].id, id_operador, idApontamentoAutomatico],
        );
      }

      await client.query("COMMIT");

      const apontamento = result.rows[0];

      // 7. REGISTRAR LOG APPROPRIADO
      if (quantidadeTransferida > 0) {
        await registrarLog(
          "INICIO_TRANSFERIDO",
          `Apontamento iniciado com ${quantidadeTransferida} peças transferidas do sistema automático`,
          apontamento,
          apontamento.id,
          id_operador,
        );
      } else {
        await registrarLog(
          "INICIO",
          "Apontamento iniciado com sucesso",
          apontamento,
          apontamento.id,
          id_operador,
        );
      }

      // 8. RETORNAR RESPOSTA COM INFORMAÇÃO DE TRANSFERÊNCIA
      res.status(201).json({
        ...apontamento,
        quantidade_transferida: quantidadeTransferida,
        transferido_automatico: quantidadeTransferida > 0,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      await registrarErro(
        "Erro ao iniciar apontamento",
        err,
        null,
        id_operador,
      );
      res.status(500).json({ message: "Erro ao iniciar apontamento" });
    } finally {
      client.release();
    }
  },
);

//Rota apontamento Montagem / Embalagem
app.post(
  "/apontamento/iniciar-montagem",
  autenticarToken,
  [
    body("id_operador").isNumeric().withMessage("ID do operador é obrigatório"),
    body("id_maquina").isNumeric().withMessage("ID da máquina é obrigatório"),
    body("id_produto").isNumeric().withMessage("ID do produto é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await registrarLog(
        "ERRO",
        "Validação falhou ao iniciar apontamento de montagem",
        {
          errors: errors.array(),
        },
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const client = await pool.connect();
    const { id_operador, id_maquina, id_produto } = req.body;

    try {
      await client.query("BEGIN");

      // 1. VERIFICAR SE EXISTE APONTAMENTO AUTOMÁTICO (NOVA FUNCIONALIDADE)
      let quantidadeTransferida = 0;
      let idApontamentoAutomatico = null;

      const apontamentoAutomaticoResult = await client.query(
        `SELECT id, quantidade_pecas 
         FROM apontamento_producao 
         WHERE id_maquina = $1 
         AND status = 'EM_ANDAMENTO' 
         AND origem_automatica = true
         ORDER BY data_inicio DESC 
         LIMIT 1`,
        [id_maquina],
      );

      // 2. SE EXISTIR APONTAMENTO AUTOMÁTICO, TRANSFERIR
      if (apontamentoAutomaticoResult.rows.length > 0) {
        idApontamentoAutomatico = apontamentoAutomaticoResult.rows[0].id;
        quantidadeTransferida =
          apontamentoAutomaticoResult.rows[0].quantidade_pecas || 0;

        // Finalizar o apontamento automático
        await client.query(
          `UPDATE apontamento_producao 
           SET status = 'FINALIZADO', 
               data_fim = NOW(),
               motivo_transferencia = 'Transferido para apontamento manual de montagem'
           WHERE id = $1`,
          [idApontamentoAutomatico],
        );

        await registrarLog(
          "TRANSFERENCIA_MONTAGEM",
          `Apontamento automático finalizado e transferido: ${quantidadeTransferida} peças`,
          {
            id_apontamento_automatico: idApontamentoAutomatico,
            quantidade_transferida: quantidadeTransferida,
            tipo: "montagem",
          },
          null,
          id_operador,
        );
      }

      // 3. CRIAR NOVO APONTAMENTO (MANTIDO ORIGINAL COM PEÇAS TRANSFERIDAS)
      const result = await client.query(
        `INSERT INTO apontamento_producao 
         (id_operador, id_maquina, id_produto, data_inicio, status, quantidade_pecas) 
         VALUES ($1, $2, $3, NOW(), $4, $5) 
         RETURNING *`,
        [
          id_operador,
          id_maquina,
          id_produto,
          "EM_ANDAMENTO",
          quantidadeTransferida,
        ],
      );

      // 4. SE HOUVE TRANSFERÊNCIA, MOVER OS PULSOS TAMBÉM
      if (quantidadeTransferida > 0 && idApontamentoAutomatico) {
        await client.query(
          `UPDATE apontamento_pulsos 
           SET id_apontamento = $1, id_operador = $2
           WHERE id_apontamento = $3`,
          [result.rows[0].id, id_operador, idApontamentoAutomatico],
        );
      }

      await client.query("COMMIT");

      const apontamento = result.rows[0];

      // 5. REGISTRAR LOG APPROPRIADO
      if (quantidadeTransferida > 0) {
        await registrarLog(
          "INICIO_MONTAGEM_TRANSFERIDO",
          `Apontamento de montagem iniciado com ${quantidadeTransferida} peças transferidas do sistema automático`,
          apontamento,
          apontamento.id,
          id_operador,
        );
      } else {
        await registrarLog(
          "INICIO_MONTAGEM",
          "Apontamento de montagem iniciado com sucesso",
          apontamento,
          apontamento.id,
          id_operador,
        );
      }

      // 6. RETORNAR RESPOSTA COM INFORMAÇÃO DE TRANSFERÊNCIA
      res.status(201).json({
        ...apontamento,
        quantidade_transferida: quantidadeTransferida,
        transferido_automatico: quantidadeTransferida > 0,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      await registrarErro(
        "Erro ao iniciar apontamento de montagem",
        err,
        null,
        id_operador,
      );
      console.error("Erro ao iniciar apontamento de montagem:", err);
      res
        .status(500)
        .json({ message: "Erro ao iniciar apontamento de montagem" });
    } finally {
      client.release();
    }
  },
);

// Rota para pausar apontamento
app.post(
  "/apontamento/pausar",
  autenticarToken,
  [
    body("id_apontamento")
      .isNumeric()
      .withMessage("ID do apontamento inválido"),
    body("motivo_parada")
      .notEmpty()
      .withMessage("Motivo da parada é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await registrarLog("ERRO", "Validação falhou ao pausar apontamento", {
        errors: errors.array(),
      });
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_apontamento, motivo_parada } = req.body;

    try {
      await pool.query("BEGIN");

      const updateApontamento = await pool.query(
        "UPDATE apontamento_producao SET status = $1 WHERE id = $2 RETURNING *",
        ["PAUSADO", id_apontamento],
      );

      if (updateApontamento.rows.length === 0) {
        await pool.query("ROLLBACK");
        await registrarLog(
          "ERRO",
          "Apontamento não encontrado ao tentar pausar",
          { id_apontamento },
        );
        return res.status(404).json({ message: "Apontamento não encontrado" });
      }

      const insertParada = await pool.query(
        "INSERT INTO paradas_producao (id_apontamento, motivo_parada, data_inicio) VALUES ($1, $2, NOW()) RETURNING *",
        [id_apontamento, motivo_parada],
      );

      await pool.query(
        `UPDATE ordem_producao SET status = 'PAUSADO' 
       WHERE id = (SELECT id_ordem_producao FROM apontamento_producao WHERE id = $1)`,
        [id_apontamento],
      );

      await pool.query("COMMIT");

      const apontamento = updateApontamento.rows[0];
      await registrarLog(
        "PAUSA",
        "Apontamento pausado",
        {
          id_apontamento,
          motivo_parada,
          apontamento,
        },
        id_apontamento,
        apontamento.id_operador,
      );

      res.status(201).json({
        apontamento: apontamento,
        parada: insertParada.rows[0],
      });
    } catch (err) {
      await pool.query("ROLLBACK");
      await registrarErro("Erro ao pausar apontamento", err, id_apontamento);
      res.status(500).json({
        message: "Erro ao pausar apontamento",
        error: err.message,
      });
    }
  },
);

// ✅ ROTA: Apontar máquina parada COMPLETA (registra em ambas tabelas)
app.post(
  "/apontamento/maquina-parada-completa",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_operador, id_maquina, motivo_parada } = req.body;

      console.log(
        `🚫 Registrando parada completa da máquina ${id_maquina}: ${motivo_parada}`,
      );

      let id_apontamento = null;
      let id_parada = null;

      // 1. Buscar ou CRIAR apontamento ativo da máquina
      const apontamentoResult = await pool.query(
        `SELECT id, status FROM apontamento_producao 
       WHERE id_maquina = $1 AND status IN ('EM_ANDAMENTO', 'PAUSADO', 'MAQUINA_PARADA') 
       ORDER BY data_inicio DESC LIMIT 1`,
        [id_maquina],
      );

      if (apontamentoResult.rows.length > 0) {
        // ✅ Já existe apontamento ativo
        id_apontamento = apontamentoResult.rows[0].id;
        const status_atual = apontamentoResult.rows[0].status;

        console.log(
          `📋 Apontamento existente encontrado: ID ${id_apontamento}, Status: ${status_atual}`,
        );

        // Registrar na tabela paradas_producao (apenas se não for MAQUINA_PARADA)
        if (status_atual !== "MAQUINA_PARADA") {
          const paradaResult = await pool.query(
            `INSERT INTO paradas_producao (id_apontamento, motivo_parada, data_inicio) 
           VALUES ($1, $2, NOW()) RETURNING id`,
            [id_apontamento, motivo_parada],
          );

          id_parada = paradaResult.rows[0].id;
          console.log(`✅ Parada registrada na tabela: ID ${id_parada}`);
        }
      } else {
        // ❌ NÃO existe apontamento ativo - CRIAR UM NOVO
        console.log(
          `🆕 Nenhum apontamento ativo encontrado. Criando novo apontamento...`,
        );

        const novoApontamentoResult = await pool.query(
          `INSERT INTO apontamento_producao 
         (id_operador, id_maquina, data_inicio, status, motivo_parada_maquina) 
         VALUES ($1, $2, NOW(), 'MAQUINA_PARADA', $3) 
         RETURNING id`,
          [id_operador, id_maquina, motivo_parada],
        );

        id_apontamento = novoApontamentoResult.rows[0].id;
        console.log(`✅ Novo apontamento criado: ID ${id_apontamento}`);

        // Registrar na tabela paradas_producao também
        const paradaResult = await pool.query(
          `INSERT INTO paradas_producao (id_apontamento, motivo_parada, data_inicio) 
         VALUES ($1, $2, NOW()) RETURNING id`,
          [id_apontamento, motivo_parada],
        );

        id_parada = paradaResult.rows[0].id;
        console.log(`✅ Parada registrada na tabela: ID ${id_parada}`);
      }

      // 2. Atualizar campo motivo_parada_maquina (para apontamentos existentes)
      if (id_apontamento) {
        const updateResult = await pool.query(
          `UPDATE apontamento_producao 
         SET status = 'MAQUINA_PARADA', motivo_parada_maquina = $1
         WHERE id = $2`,
          [motivo_parada, id_apontamento],
        );

        console.log(
          `✅ Apontamento ${id_apontamento} atualizado para MAQUINA_PARADA`,
        );
      }

      res.json({
        success: true,
        id_parada: id_parada,
        id_apontamento: id_apontamento,
        message: "Parada registrada com sucesso em ambas as tabelas",
        apontamento_criado: apontamentoResult.rows.length === 0, // Indica se foi criado novo
      });
    } catch (error) {
      console.error("❌ Erro ao registrar parada completa:", error);
      res.status(500).json({
        success: false,
        error: "Erro ao registrar parada",
        details: error.message,
      });
    }
  },
);

// ✅ ROTA: Retomar máquina parada COMPLETA
app.post(
  "/apontamento/retomar-maquina-completa",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_operador, id_maquina } = req.body;

      console.log(`▶️ Retomando máquina ${id_maquina} do modo parada completa`);

      // 1. Buscar apontamento em MAQUINA_PARADA
      const apontamentoResult = await pool.query(
        `SELECT id FROM apontamento_producao 
       WHERE id_maquina = $1 AND status = 'MAQUINA_PARADA'
       ORDER BY data_inicio DESC LIMIT 1`,
        [id_maquina],
      );

      if (apontamentoResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Nenhuma máquina parada encontrada para retomar",
        });
      }

      const id_apontamento = apontamentoResult.rows[0].id;
      console.log(
        `📋 Apontamento encontrado para retomada: ID ${id_apontamento}`,
      );

      // 2. Finalizar paradas em aberto na tabela paradas_producao
      const paradasResult = await pool.query(
        `UPDATE paradas_producao 
       SET data_fim = NOW()
       WHERE id_apontamento = $1 AND data_fim IS NULL
       RETURNING id`,
        [id_apontamento],
      );

      console.log(
        `✅ ${paradasResult.rowCount} parada(s) finalizada(s) na tabela`,
      );

      // 3. Verificar se deve manter apontamento ou finalizar
      // Se foi um apontamento criado apenas para a parada, finalizar
      const apontamentoInfo = await pool.query(
        `SELECT quantidade_pecas, data_inicio FROM apontamento_producao 
       WHERE id = $1`,
        [id_apontamento],
      );
      const apontamento = apontamentoInfo.rows[0];
      const tempoExiste =
        (new Date() - new Date(apontamento.data_inicio)) / 1000; // segundos

      let acao_tomada = "RETOMADO";

      if (apontamento.quantidade_pecas === 0 && tempoExiste < 300) {
        // 5 minutos
        // Apontamento foi criado apenas para a parada - FINALIZAR
        await pool.query(
          `UPDATE apontamento_producao 
         SET status = 'FINALIZADO', data_fim = NOW(), motivo_parada_maquina = NULL
         WHERE id = $1`,
          [id_apontamento],
        );
        acao_tomada = "FINALIZADO";
        console.log(
          `✅ Apontamento ${id_apontamento} finalizado (criado apenas para parada)`,
        );
      } else {
        // Apontamento existente - apenas retomar
        await pool.query(
          `UPDATE apontamento_producao 
         SET status = 'EM_ANDAMENTO', motivo_parada_maquina = NULL
         WHERE id = $1`,
          [id_apontamento],
        );
        acao_tomada = "RETOMADO";
        console.log(
          `✅ Apontamento ${id_apontamento} retomado para EM_ANDAMENTO`,
        );
      }

      res.json({
        success: true,
        id_apontamento: id_apontamento,
        paradas_finalizadas: paradasResult.rowCount,
        acao_tomada: acao_tomada,
        message: `Máquina ${acao_tomada.toLowerCase()} com sucesso`,
      });
    } catch (error) {
      console.error("❌ Erro ao retomar máquina completa:", error);
      res.status(500).json({
        success: false,
        error: "Erro ao retomar máquina",
        details: error.message,
      });
    }
  },
);

// Rota para apontar máquina parada
app.post(
  "/apontamento/maquina-parada",
  autenticarToken,
  [
    body("id_operador").isNumeric().withMessage("ID do operador é obrigatório"),
    body("id_maquina").isNumeric().withMessage("ID da máquina é obrigatório"),
    body("motivo_parada")
      .notEmpty()
      .withMessage("Motivo da parada é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_operador, id_maquina, motivo_parada } = req.body;

    // Verificar se o operador tem permissão (IDs 6, 1, 15, 33, 20)
    const operadoresPermitidos = [6, 1, 15, 33, 20];
    if (!operadoresPermitidos.includes(parseInt(id_operador))) {
      return res
        .status(403)
        .json({ message: "Operador não autorizado para esta ação" });
    }

    try {
      // Verificar se já existe um apontamento de máquina parada para esta máquina
      const apontamentoExistente = await pool.query(
        "SELECT * FROM apontamento_producao WHERE id_maquina = $1 AND status = 'MAQUINA_PARADA'",
        [id_maquina],
      );

      if (apontamentoExistente.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Máquina já está marcada como parada" });
      }

      // Verificar se há apontamentos ativos normais para esta máquina e finalizá-los
      const apontamentosAtivos = await pool.query(
        "SELECT * FROM apontamento_producao WHERE id_maquina = $1 AND status IN ('EM_ANDAMENTO', 'PAUSADO')",
        [id_maquina],
      );

      for (const apontamento of apontamentosAtivos.rows) {
        await pool.query(
          "UPDATE apontamento_producao SET status = 'FINALIZADO', data_fim = NOW() WHERE id = $1",
          [apontamento.id],
        );
      }

      // Criar apontamento de máquina parada com id_produto NULL
      const result = await pool.query(
        `INSERT INTO apontamento_producao 
         (id_operador, id_maquina, id_produto, status, data_inicio, motivo_parada_maquina) 
         VALUES ($1, $2, NULL, 'MAQUINA_PARADA', NOW(), $3) 
         RETURNING *`,
        [id_operador, id_maquina, motivo_parada],
      );

      await registrarLog(
        "MAQUINA_PARADA",
        "Máquina marcada como parada",
        {
          id_maquina,
          motivo_parada,
          id_operador,
        },
        result.rows[0].id,
        id_operador,
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao registrar máquina parada:", err);
      res.status(500).json({ message: "Erro ao registrar máquina parada" });
    }
  },
);

// Rota para retomar máquina parada
app.post(
  "/apontamento/retomar-maquina",
  autenticarToken,
  [
    body("id_operador").isNumeric().withMessage("ID do operador é obrigatório"),
    body("id_maquina").isNumeric().withMessage("ID da máquina é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_operador, id_maquina } = req.body;

    // Verificar se o operador tem permissão
    const operadoresPermitidos = [6, 1, 15, 33, 20];
    if (!operadoresPermitidos.includes(parseInt(id_operador))) {
      return res
        .status(403)
        .json({ message: "Operador não autorizado para esta ação" });
    }

    try {
      // Finalizar apontamento de máquina parada
      const result = await pool.query(
        `UPDATE apontamento_producao 
         SET status = 'FINALIZADO', data_fim = NOW()
         WHERE id_maquina = $1 AND status = 'MAQUINA_PARADA'
         RETURNING *`,
        [id_maquina],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ message: "Nenhuma máquina parada encontrada" });
      }

      await registrarLog(
        "MAQUINA_RETOMADA",
        "Máquina retomada da parada",
        {
          id_maquina,
          id_operador,
        },
        result.rows[0].id,
        id_operador,
      );

      res.status(200).json({ message: "Máquina retomada com sucesso" });
    } catch (err) {
      console.error("Erro ao retomar máquina:", err);
      res.status(500).json({ message: "Erro ao retomar máquina" });
    }
  },
);

app.get("/health/database", async (req, res) => {
  try {
    const result = await safeQuery(
      "SELECT NOW() as current_time, version() as pg_version",
    );
    res.json({
      status: "healthy",
      database: {
        connected: true,
        current_time: result.rows[0].current_time,
        version: result.rows[0].pg_version,
      },
    });
  } catch (error) {
    console.error("❌ Health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      database: {
        connected: false,
        error: error.message,
        code: error.code,
      },
    });
  }
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Recebido SIGINT. Encerrando graceful...");
  await gracefulShutdown();
});

process.on("SIGTERM", async () => {
  console.log("🛑 Recebido SIGTERM. Encerrando graceful...");
  await gracefulShutdown();
});

async function gracefulShutdown() {
  console.log("🔌 Fechando pool de conexões...");
  try {
    await pool.end();
    console.log("✅ Pool fechado com sucesso");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao fechar pool:", error);
    process.exit(1);
  }
}

app.get(
  "/apontamento/verificar-maquina-parada/:id_maquina",
  autenticarToken,
  async (req, res) => {
    try {
      const { id_maquina } = req.params;

      const result = await pool.query(
        `SELECT ap.*, m.descricao as maquina_nome 
       FROM apontamento_producao ap
       JOIN maquinas m ON ap.id_maquina = m.id
       WHERE ap.id_maquina = $1 AND ap.status = 'MAQUINA_PARADA'`,
        [id_maquina],
      );

      if (result.rows.length > 0) {
        res.status(200).json({
          maquinaParada: true,
          motivo: result.rows[0].motivo_parada_maquina,
        });
      } else {
        res.status(200).json({
          maquinaParada: false,
          motivo: "",
        });
      }
    } catch (err) {
      console.error("Erro ao verificar máquina parada:", err);
      res.status(500).json({ message: "Erro ao verificar status da máquina" });
    }
  },
);

// Rota para buscar todas as máquinas paradas
app.get("/apontamento/maquinas-paradas", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ap.*, m.descricao as maquina_nome, o.nome as operador_nome
       FROM apontamento_producao ap
       JOIN maquinas m ON ap.id_maquina = m.id
       JOIN operadores o ON ap.id_operador = o.id
       WHERE ap.status = 'MAQUINA_PARADA'`,
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar máquinas paradas:", err);
    res.status(500).json({ message: "Erro ao buscar máquinas paradas" });
  }
});

app.get("/health/database", async (req, res) => {
  try {
    const result = await safeQuery(
      "SELECT NOW() as current_time, version() as pg_version",
    );
    res.json({
      status: "healthy",
      database: {
        connected: true,
        current_time: result.rows[0].current_time,
        version: result.rows[0].pg_version,
      },
    });
  } catch (error) {
    console.error("❌ Health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      database: {
        connected: false,
        error: error.message,
        code: error.code,
      },
    });
  }
});

app.get("/apontamento/:id/tempo-real", async (req, res) => {
  try {
    const { id } = req.params;

    // Validar ID
    if (!id || isNaN(id)) {
      return res.status(400).json({
        error: "ID inválido",
        tempo_real: "00:00:00",
        tempo_pausa: 0,
      });
    }

    const tempoReal = await calcularTempoProducaoReal(parseInt(id));
    res.json(tempoReal);
  } catch (error) {
    console.error("❌ Erro no endpoint tempo-real:", error.message);
    res.status(500).json({
      error: "Erro ao calcular tempo real",
      tempo_real: "00:00:00",
      tempo_pausa: 0,
    });
  }
});

setInterval(async () => {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    console.warn("⚠️ Verificação periódica: Conexão com banco perdida");
  }
}, 30000); // Verificar a cada 30 segundos

//Rota debug apontamento
app.get("/debug/apontamento/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "SELECT id, status FROM apontamento_producao WHERE id = $1",
      [id],
    );
    res.status(200).json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota para retomar o apontamento e finalizar a pausa
app.post(
  "/apontamento/retomar",
  autenticarToken,
  [
    body("id_apontamento")
      .isNumeric()
      .withMessage("ID do apontamento é obrigatório"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_apontamento } = req.body;

    try {
      // Finaliza a pausa atual
      await pool.query(
        `UPDATE paradas_producao 
       SET data_fim = NOW() 
       WHERE id_apontamento = $1 AND data_fim IS NULL 
       RETURNING *`,
        [id_apontamento],
      );

      // Retoma o apontamento
      await pool.query(
        `UPDATE apontamento_producao
       SET status = 'EM_ANDAMENTO'
       WHERE id = $1 RETURNING *`,
        [id_apontamento],
      );

      // Atualiza o status da ordem de produção vinculada ao apontamento
      await pool.query(
        `UPDATE ordem_producao
       SET status = 'EM_ANDAMENTO'
       WHERE id = (SELECT id_ordem_producao FROM apontamento_producao WHERE id = $1)`,
        [id_apontamento],
      );

      res.status(200).json({ message: "Produção retomada com sucesso" });
    } catch (err) {
      console.error("Erro ao retomar apontamento:", err);
      res.status(500).json({ message: "Erro ao retomar apontamento" });
    }
  },
);

// Rota para buscar apontamento em andamento de um operador
app.get(
  "/apontamento/em-andamento/:id_operador",
  autenticarToken,
  async (req, res) => {
    const { id_operador } = req.params;

    try {
      const result = await pool.query(
        `SELECT ap.*, pp.motivo_parada, pp.data_inicio as data_inicio_pausa
       FROM apontamento_producao ap
       LEFT JOIN paradas_producao pp ON ap.id = pp.id_apontamento AND pp.data_fim IS NULL
       WHERE ap.id_operador = $1 AND (ap.status = 'EM_ANDAMENTO' OR ap.status = 'PAUSADO')
       ORDER BY ap.data_inicio DESC
       LIMIT 1`,
        [id_operador],
      );

      if (result.rows.length > 0) {
        const apontamento = result.rows[0];

        // Verifica se há uma pausa ativa
        if (apontamento.data_inicio_pausa) {
          apontamento.status = "PAUSADO"; // Define o status como pausado
        } else {
          apontamento.status = "EM_ANDAMENTO"; // Define o status como em andamento
        }

        res.status(200).json(apontamento); // Retorna o apontamento com o status correto
      } else {
        res
          .status(404)
          .json({ message: "Nenhum apontamento em andamento encontrado" });
      }
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Erro ao buscar apontamento em andamento" });
    }
  },
);

//Rota para finalizar paradas
app.post("/apontamento/paradas/finalizar/:id_apontamento", async (req, res) => {
  const { id_apontamento } = req.params;

  try {
    const result = await pool.query(
      `UPDATE paradas_producao
       SET data_fim = NOW()
       WHERE id_apontamento = $1 AND data_fim IS NULL
       RETURNING *`,
      [id_apontamento],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Nenhuma parada em aberto encontrada para este apontamento",
      });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    // console.error(err);
    // res.status(500).json({ message: 'Erro ao finalizar parada' });
  }
});

// Rota para calcular tempo de pausa de um apontamento específico
app.get("/apontamento/tempo-pausa/:id_apontamento", async (req, res) => {
  const { id_apontamento } = req.params;

  try {
    // Para pausas já finalizadas deste apontamento
    const resultFinalizadas = await pool.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (data_fim - data_inicio)), 0) as tempo_total_pausa
       FROM paradas_producao
       WHERE id_apontamento = $1 AND data_fim IS NOT NULL`,
      [id_apontamento],
    );

    // Para pausas em andamento deste apontamento
    const resultEmAndamento = await pool.query(
      `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (NOW() - data_inicio)), 0) as tempo_pausa_em_andamento
       FROM paradas_producao
       WHERE id_apontamento = $1 AND data_fim IS NULL`,
      [id_apontamento],
    );

    const tempoFinalizadas = parseFloat(
      resultFinalizadas.rows[0].tempo_total_pausa,
    );
    const tempoEmAndamento = parseFloat(
      resultEmAndamento.rows[0].tempo_pausa_em_andamento,
    );
    const tempo_total_pausa = tempoFinalizadas + tempoEmAndamento;

    res.status(200).json({
      tempo_total_pausa,
      tempo_finalizadas: tempoFinalizadas,
      tempo_em_andamento: tempoEmAndamento,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao calcular tempo de pausa" });
  }
});

// Rota para verificar tempo mínimo do apontamento
app.get(
  "/apontamento/verificar-tempo-minimo/:id_apontamento",
  async (req, res) => {
    const { id_apontamento } = req.params;

    try {
      const result = await pool.query(
        `SELECT 
        EXTRACT(EPOCH FROM (NOW() - data_inicio)) as tempo_decorrido
       FROM apontamento_producao 
       WHERE id = $1`,
        [id_apontamento],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Apontamento não encontrado" });
      }

      res.status(200).json({
        tempo_decorrido: result.rows[0].tempo_decorrido,
      });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ message: "Erro ao verificar tempo do apontamento" });
    }
  },
);

// Rota para obter apontamento ativo específico por máquina
app.get(
  "/api/apontamento/ativo/:maquinaId",
  autenticarToken,
  async (req, res) => {
    try {
      const { maquinaId } = req.params;
      // console.log(`Buscando apontamento ativo para máquina ${maquinaId}...`);

      const result = await pool.query(
        `
      SELECT 
        id, 
        id_maquina, 
        id_operador,
        id_produto,
        id_ordem_producao,
        quantidade_pecas,
        origem_automatica,
        device_id
      FROM apontamento_producao 
      WHERE id_maquina = $1
      AND status = 'EM_ANDAMENTO'
      ORDER BY 
        -- Prioriza apontamentos manuais sobre automáticos
        CASE WHEN origem_automatica = false THEN 0 ELSE 1 END,
        data_inicio DESC 
      LIMIT 1
    `,
        [maquinaId],
      );

      console.log("Resultado da busca:", result.rows);

      if (result.rows.length > 0) {
        res.json(result.rows[0]);
      } else {
        res.json({ id: 0 });
      }
    } catch (err) {
      console.error("Erro ao buscar apontamento ativo:", err);
      res.status(500).json({ error: "Erro no servidor" });
    }
  },
);

// Rotas para o dashboard
app.get("/apontamento/ativos", async (req, res) => {
  try {
    const query = `
      SELECT 
        ap.*,
        op.nome AS operador_nome,
        ma.descricao AS maquina_descricao,
        pr.ds_produto AS produto_descricao,
        EXISTS (
          SELECT 1 FROM paradas_producao pp 
          WHERE pp.id_apontamento = ap.id AND pp.data_fim IS NULL
        ) as tem_pausa_ativa
      FROM apontamento_producao ap
      LEFT JOIN operadores op ON ap.id_operador = op.id
      LEFT JOIN maquinas ma ON ap.id_maquina = ma.id
      LEFT JOIN produtos pr ON ap.id_produto = pr.id
      WHERE ap.status IN ('EM_ANDAMENTO', 'PAUSADO')
      ORDER BY ap.data_inicio DESC
    `;

    const { rows } = await pool.query(query);

    // Adicionar tempo real de produção para cada apontamento
    const apontamentosComTempoReal = await Promise.all(
      rows.map(async (apontamento) => {
        const tempoReal = await calcularTempoProducaoReal(apontamento.id);
        return {
          ...apontamento,
          tempo_real_producao: tempoReal.tempo_real,
          tempo_total_pausa: tempoReal.tempo_pausa,
        };
      }),
    );

    res.json(apontamentosComTempoReal);
  } catch (error) {
    console.error("Erro ao buscar apontamentos ativos:", error);
    res.status(500).json({
      error: "Erro ao buscar apontamentos ativos",
      details: error.message,
    });
  }
});

// Rota para métricas de produção atualizada
app.get("/apontamento/metricas", async (req, res) => {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const queries = await Promise.all([
      pool.query(
        "SELECT COUNT(*) FROM apontamento_producao WHERE status = 'EM_ANDAMENTO'",
      ),
      pool.query(
        "SELECT COUNT(*) FROM apontamento_producao WHERE status = 'PAUSADO'",
      ),
      // Peças montadas (tipo_maquina = MONTAGEM)
      pool.query(
        `
        SELECT COALESCE(SUM(ap.quantidade_pecas), 0) 
        FROM apontamento_producao ap
        JOIN maquinas m ON ap.id_maquina = m.id
        WHERE ap.status = 'FINALIZADO' 
        AND ap.data_fim >= $1
        AND m.tipo_maquina = 'MONTAGEM'
      `,
        [hoje],
      ),
      // Peças embaladas (tipo_maquina = EMBALAGEM)
      pool.query(
        `
        SELECT COALESCE(SUM(ap.quantidade_pecas), 0) 
        FROM apontamento_producao ap
        JOIN maquinas m ON ap.id_maquina = m.id
        WHERE ap.status = 'FINALIZADO' 
        AND ap.data_fim >= $1
        AND m.tipo_maquina = 'EMBALAGEM'
      `,
        [hoje],
      ),
      // Refugo total
      pool.query(
        `
        SELECT COALESCE(SUM(refugo_kg), 0) 
        FROM apontamento_producao 
        WHERE status = 'FINALIZADO' AND data_fim >= $1
      `,
        [hoje],
      ),
    ]);

    res.json({
      totalAtivos: parseInt(queries[0].rows[0].count),
      totalPausados: parseInt(queries[1].rows[0].count),
      pecasMontadas: parseInt(queries[2].rows[0].coalesce),
      pecasEmbaladas: parseInt(queries[3].rows[0].coalesce),
      refugoKg: parseFloat(queries[4].rows[0].coalesce),
    });
  } catch (error) {
    console.error("Erro ao calcular métricas:", error);
    res.status(500).json({
      error: "Erro ao calcular métricas de produção",
      details: error.message,
    });
  }
});

//Rota para o calculo OEE
app.get("/oee", async (req, res) => {
  try {
    // Dados de produção
    const producao = await pool.query(`
      SELECT COUNT(*) as total_pecas, SUM(quantidade_pecas) as pecas_boas
      FROM apontamento_producao
      WHERE status = 'FINALIZADO'
    `);

    // Dados de parada
    const paradas = await pool.query(`
      SELECT SUM(EXTRACT(EPOCH FROM (data_fim - data_inicio))) as tempo_parada
      FROM paradas_producao
    `);

    // Tempo total planejado (exemplo: 8 horas por dia)
    const tempo_planejado = 18 * 3600; // 18 horas em segundos

    // Cálculos
    const tempo_parada = paradas.rows[0].tempo_parada || 0;
    const tempo_producao_real = tempo_planejado - tempo_parada;
    const disponibilidade = tempo_producao_real / tempo_planejado;

    const total_pecas = producao.rows[0].total_pecas || 0;
    const pecas_boas = producao.rows[0].pecas_boas || 0;
    const desempenho = total_pecas / (tempo_producao_real / 60); // Produção por minuto
    const qualidade = pecas_boas / total_pecas;

    const oee = disponibilidade * desempenho * qualidade * 100; // Em porcentagem

    res.status(200).json({ oee, disponibilidade, desempenho, qualidade });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao calcular OEE" });
  }
});
// Listar todos os motivos de refugo ativos
app.get("/apontamento/motivos-refugo", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, descricao, tipo 
       FROM motivos_refugo 
       WHERE ativo = true 
       ORDER BY tipo, descricao`,
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar motivos de refugo:", err);
    res.status(500).json({ message: "Erro ao buscar motivos de refugo" });
  }
});

// Rota para finalizar apontamento
app.post(
  "/apontamento/finalizar",
  autenticarToken,
  [
    body("id_apontamento")
      .isNumeric()
      .withMessage("ID do apontamento é obrigatório"),
    body("quantidade_pecas")
      .isNumeric()
      .withMessage("Quantidade de peças é obrigatória"),
    body("refugo_kg").isNumeric().withMessage("Refugo em kg é obrigatório"),
    body("id_motivo_refugo")
      .optional({ nullable: true })
      .isNumeric()
      .withMessage("ID do motivo de refugo deve ser numérico"),
  ],
  async (req, res) => {
    console.log("Dados recebidos:", req.body); // Adicione este log

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log("Erros de validação:", errors.array()); // Log dos erros
      await registrarLog(
        "ERRO_VALIDACAO",
        "Erro de validação ao finalizar apontamento",
        { errors: errors.array() },
      );
      return res.status(400).json({ errors: errors.array() });
    }

    const { id_apontamento, quantidade_pecas, refugo_kg, id_motivo_refugo } =
      req.body;
    const userId = req.user.id; // ID do usuário autenticado

    try {
      await pool.query("BEGIN");

      // 1. Buscar informações do motivo de refugo (se fornecido)
      let motivoRefugo = null;
      if (id_motivo_refugo) {
        const motivoResult = await pool.query(
          "SELECT descricao, tipo FROM motivos_refugo WHERE id = $1",
          [id_motivo_refugo],
        );

        if (motivoResult.rows.length === 0) {
          await pool.query("ROLLBACK");
          await registrarLog(
            "ERRO_REFUGO",
            "Motivo de refugo não encontrado",
            { id_motivo_refugo },
            id_apontamento,
            userId,
          );
          return res
            .status(404)
            .json({ message: "Motivo de refugo não encontrado" });
        }
        motivoRefugo = motivoResult.rows[0];
      }

      // 2. Atualizar o apontamento
      const updateQuery = `
      UPDATE apontamento_producao 
      SET 
        data_fim = NOW(),
        quantidade_pecas = $1,
        refugo_kg = $2,
        id_motivo_refugo = $3,
        motivo_refugo_descricao = $4,
        motivo_refugo_tipo = $5,
        status = 'FINALIZADO'
      WHERE id = $6
      RETURNING *`;

      const updateValues = [
        quantidade_pecas,
        refugo_kg,
        id_motivo_refugo || null,
        motivoRefugo?.descricao || null,
        motivoRefugo?.tipo || null,
        id_apontamento,
      ];

      const result = await pool.query(updateQuery, updateValues);

      if (result.rows.length === 0) {
        await pool.query("ROLLBACK");
        await registrarLog(
          "ERRO_APONTAMENTO",
          "Apontamento não encontrado",
          { id_apontamento },
          null,
          userId,
        );
        return res.status(404).json({ message: "Apontamento não encontrado" });
      }

      // 3. Atualizar a ordem de produção relacionada (se existir)
      try {
        await pool.query(
          `UPDATE ordem_producao op
         SET status = 'FINALIZADA',
             quantidade_restante = GREATEST(0, op.quantidade - $1)
         WHERE id = (
           SELECT id_ordem_producao 
           FROM apontamento_producao 
           WHERE id = $2
         )`,
          [quantidade_pecas, id_apontamento],
        );
      } catch (err) {
        console.warn(
          "Aviso: Não foi possível atualizar ordem de produção",
          err,
        );
        // Não fazemos rollback por esse erro, apenas registramos
        await registrarLog(
          "AVISO_ORDEM",
          "Erro ao atualizar ordem de produção",
          { error: err.message },
          id_apontamento,
          userId,
        );
      }

      await pool.query("COMMIT");

      const apontamentoFinalizado = result.rows[0];
      await registrarLog(
        "FINALIZACAO",
        "Apontamento finalizado com sucesso",
        {
          quantidade_pecas,
          refugo_kg,
          id_motivo_refugo,
          motivo_descricao: motivoRefugo?.descricao,
        },
        id_apontamento,
        userId,
      );

      res.status(200).json(apontamentoFinalizado);
    } catch (err) {
      await pool.query("ROLLBACK");
      console.error("Erro ao finalizar apontamento:", err);

      await registrarErro(
        "Erro ao finalizar apontamento",
        err,
        id_apontamento,
        userId,
      );

      // Tratamento específico para erro de chave estrangeira
      if (err.code === "23503" && err.constraint.includes("id_motivo_refugo")) {
        return res.status(400).json({
          message: "Motivo de refugo inválido",
          details: err.message,
        });
      }

      res.status(500).json({
        message: "Erro ao finalizar apontamento",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
);

// Rota para consultar logs
app.get("/logs/apontamento", autenticarToken, async (req, res) => {
  if (!req.user.administrador) {
    return res.status(403).json({
      message: "Acesso negado: apenas administradores podem visualizar logs",
    });
  }

  try {
    const { id_apontamento, id_operador, tipo_evento, limit = 100 } = req.query;

    let query =
      "SELECT l.*, o.nome as operador_nome FROM logs_apontamento l LEFT JOIN operadores o ON l.id_operador = o.id";
    const params = [];
    const conditions = [];

    if (id_apontamento) {
      conditions.push(`l.id_apontamento = $${params.length + 1}`);
      params.push(id_apontamento);
    }

    if (id_operador) {
      conditions.push(`l.id_operador = $${params.length + 1}`);
      params.push(id_operador);
    }

    if (tipo_evento) {
      conditions.push(`l.tipo_evento = $${params.length + 1}`);
      params.push(tipo_evento);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += ` ORDER BY l.data_criacao DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar logs" });
  }
});

// Rota para criar uma nova ordem de produção
app.post(
  "/ordem-producao",
  [
    body("id_produto").isNumeric().withMessage("ID do produto é obrigatório"),
    body("quantidade").isNumeric().withMessage("Quantidade é obrigatória"),
    body("id_operador_responsavel").optional().isNumeric(),
    body("observacoes").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log("Erros de validação:", errors.array()); // Log dos erros de validação
      return res.status(400).json({ errors: errors.array() });
    }

    console.log("Corpo da requisição:", req.body); // Log do corpo da requisição

    const { id_produto, quantidade, id_operador_responsavel, observacoes } =
      req.body;

    try {
      const numeroOrdem = await gerarNumeroOrdem();
      const result = await pool.query(
        "INSERT INTO ordem_producao (id, id_produto, quantidade, id_operador_responsavel, observacoes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [
          numeroOrdem,
          id_produto,
          quantidade,
          id_operador_responsavel,
          observacoes,
        ],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao criar ordem de produção" });
    }
  },
);

// Rota para listar todas as ordens de produção
app.get("/ordem-producao", async (req, res) => {
  try {
    const result = await pool.query(`
    SELECT op.*, p.ds_produto as produto, o.nome as operador_responsavel
    FROM ordem_producao op
    LEFT JOIN produtos p ON op.id_produto = p.id
    LEFT JOIN operadores o ON op.id_operador_responsavel = o.id
      ORDER BY
        CASE
          WHEN op.status = 'PENDENTE' THEN 1
          WHEN op.status = 'EM_ANDAMENTO' THEN 2
          WHEN op.status = 'PAUSADO' THEN 3
          WHEN op.status = 'FINALIZADA' THEN 4
          ELSE 5
        END
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar ordens de produção" });
  }
});

// Rota para atualizar uma ordem de produção
app.post(
  "/ordem-producao",
  [
    body("id_produto").isNumeric().withMessage("ID do produto é obrigatório"),
    body("quantidade").isNumeric().withMessage("Quantidade é obrigatória"),
    body("id_operador_responsavel").optional().isNumeric(),
    body("observacoes").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log("Erros de validação:", errors.array()); // Log dos erros de validação
      return res.status(400).json({ errors: errors.array() });
    }

    console.log("Corpo da requisição:", req.body); // Log do corpo da requisição

    const { id_produto, quantidade, id_operador_responsavel, observacoes } =
      req.body;

    try {
      const numeroOrdem = await gerarNumeroOrdem();
      const result = await pool.query(
        "INSERT INTO ordem_producao (id, id_produto, quantidade, id_operador_responsavel, observacoes) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [
          numeroOrdem,
          id_produto,
          quantidade,
          id_operador_responsavel,
          observacoes,
        ],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao criar ordem de produção" });
    }
  },
);

// Rota para editar ordem de produção
app.put(
  "/ordem-producao/:id",
  [
    body("id_produto").optional().isNumeric(),
    body("quantidade").optional().isNumeric(),
    body("id_operador_responsavel").optional().isNumeric(),
    body("observacoes").optional().isString(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { id_produto, quantidade, id_operador_responsavel, observacoes } =
      req.body;

    try {
      // Verifica se a ordem está finalizada
      const ordemResult = await pool.query(
        "SELECT status FROM ordem_producao WHERE id = $1",
        [id],
      );

      if (ordemResult.rows.length === 0) {
        return res
          .status(404)
          .json({ message: "Ordem de produção não encontrada" });
      }

      if (ordemResult.rows[0].status === "FINALIZADA") {
        return res
          .status(400)
          .json({ message: "Não é possível editar uma ordem finalizada" });
      }

      // Atualiza a ordem de produção
      const result = await pool.query(
        "UPDATE ordem_producao SET id_produto = COALESCE($1, id_produto), quantidade = COALESCE($2, quantidade), id_operador_responsavel = COALESCE($3, id_operador_responsavel), observacoes = COALESCE($4, observacoes) WHERE id = $5 RETURNING *",
        [id_produto, quantidade, id_operador_responsavel, observacoes, id],
      );

      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao editar ordem de produção" });
    }
  },
);

// Função para gerar o próximo número da ordem
async function gerarNumeroOrdem() {
  try {
    // Busca a última ordem no banco de dados
    const result = await pool.query(
      "SELECT id FROM ordem_producao ORDER BY id DESC LIMIT 1",
    );

    if (result.rows.length > 0) {
      // Extrai o número da última ordem (ex: "OP-001" -> 1)
      const ultimoNumero = parseInt(result.rows[0].id.split("-")[1], 10);
      const proximoNumero = ultimoNumero + 1;
      return `OP-${String(proximoNumero).padStart(3, "0")}`; // Formata para "OP-002", "OP-003", etc.
    } else {
      return "OP-001";
    }
  } catch (err) {
    console.error("Erro ao gerar número da ordem:", err);
    throw err;
  }
}

//Rota para deletar ordem de produção
app.delete("/ordem-producao/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Verifica se a ordem está finalizada
    const ordemResult = await pool.query(
      "SELECT status FROM ordem_producao WHERE id = $1",
      [id],
    );

    if (ordemResult.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Ordem de produção não encontrada" });
    }

    if (ordemResult.rows[0].status === "FINALIZADA") {
      return res
        .status(400)
        .json({ message: "Não é possível excluir uma ordem finalizada" });
    }

    // Exclui a ordem de produção
    const result = await pool.query(
      "DELETE FROM ordem_producao WHERE id = $1 RETURNING *",
      [id],
    );

    res.status(200).json({ message: "Ordem de produção excluída com sucesso" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao excluir ordem de produção" });
  }
});

// Rotas de Planejamento
app.post(
  "/planejamento",
  [
    body("id_molde")
      .isInt()
      .withMessage("ID do molde deve ser um número inteiro"),
    body("id_versao_molde").optional().isInt(),
    body("id_produto").optional().isInt(),
    body("id_maquina")
      .isInt()
      .withMessage("ID da máquina deve ser um número inteiro"),
    body("quantidade")
      .isInt({ min: 1 })
      .withMessage("Quantidade deve ser um número positivo"),
    body("data_inicio")
      .isISO8601()
      .withMessage("Data de início deve estar no formato ISO 8601"),
    body("turno")
      .optional()
      .isIn(["A", "B", "C"])
      .withMessage("Turno inválido (use A, B ou C)"),
  ],
  async (req, res) => {
    // Validação dos dados
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        errors: errors.array(),
        message: "Erro de validação nos dados",
      });
    }
    console.log("Dados recebidos:", req.body);
    console.log("Tipo dos dados:", {
      id_molde: typeof req.body.id_molde,
      id_maquina: typeof req.body.id_maquina,
      quantidade: typeof req.body.quantidade,
      data_inicio: typeof req.body.data_inicio,
    });
    const { id_molde, id_maquina, quantidade, data_inicio, turno } = req.body;

    try {
      // Verificar existência do molde
      const molde = await pool.query(
        "SELECT id, tempo_ciclo FROM moldes WHERE id = $1",
        [id_molde],
      );
      if (molde.rows.length === 0) {
        return res.status(404).json({ message: "Molde não encontrado" });
      }

      // Verificar existência da máquina
      const maquina = await pool.query(
        "SELECT id FROM maquinas WHERE id = $1",
        [id_maquina],
      );
      if (maquina.rows.length === 0) {
        return res.status(404).json({ message: "Máquina não encontrada" });
      }

      app.post("/api/token", (req, res) => {
        const token = jwt.sign({ device: "ESP32" }, "SUA_CHAVE_SECRETA", {
          expiresIn: "1h",
        });
        res.json({ token });
      });

      // Calcular tempo estimado (em minutos)
      const tempo_ciclo = molde.rows[0].tempo_ciclo || 30; // default 30 segundos
      const tempo_estimado = parseFloat(
        ((quantidade * tempo_ciclo) / 60).toFixed(2),
      ); // em minutos com 2 decimais

      // Calcular data_fim
      const dataFim = new Date(
        new Date(data_inicio).getTime() + tempo_estimado * 60000,
      );

      // Inserir no banco de dados
      const result = await pool.query(
        `INSERT INTO planejamento_producao (
        id_molde, 
        id_maquina, 
        quantidade, 
        tempo_estimado, 
        data_inicio, 
        data_fim, 
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pendente')
      RETURNING *`,
        [
          id_molde,
          id_maquina,
          quantidade,
          tempo_estimado,
          new Date(data_inicio),
          dataFim,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro no banco de dados:", err);

      // Tratamento específico para violação de chave estrangeira
      if (err.code === "23503") {
        return res.status(400).json({
          message: "Erro de referência - verifique os IDs de molde e máquina",
        });
      }

      res.status(500).json({
        message: "Erro ao criar planejamento",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
);

app.get("/planejamento/calcular-tempo", async (req, res) => {
  const { id_molde, quantidade } = req.query;

  try {
    const molde = await pool.query(
      "SELECT cavidades FROM moldes WHERE id = $1",
      [id_molde],
    );
    if (molde.rows.length === 0) {
      return res.status(404).json({ message: "Molde não encontrado" });
    }

    const cavidades = molde.rows[0].cavidades;
    const tempoPorPeca = 0.5; // 30 segundos por peça
    const tempoTotal = Math.ceil((quantidade * tempoPorPeca) / cavidades);

    res.json({ tempo_estimado: tempoTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao calcular tempo" });
  }
});

app.get("/planejamento", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, 
             m.codigo as molde_codigo, 
             m.descricao as molde_descricao,
             maq.descricao as maquina_descricao
      FROM planejamento_producao p
      JOIN moldes m ON p.id_molde = m.id
      JOIN maquinas maq ON p.id_maquina = maq.id
      ORDER BY maq.descricao, p.data_inicio
    `);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar planejamentos" });
  }
});

// Rota para criar planejamento de manutenção
app.post("/api/planejamento/manutencao", (req, res) => {
  // Sua lógica para salvar manutenção no banco de dados
  const { id_maquina, data_inicio, data_fim, descricao, motivo } = req.body;

  // Exemplo com PostgreSQL (usando seu modelo existente)
  pool.query(
    "INSERT INTO planejamento_producao (id_maquina, data_inicio, data_fim, tipo, descricao, motivo, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [
      id_maquina,
      data_inicio,
      data_fim,
      "manutencao",
      descricao,
      motivo,
      "planejado",
    ],
    (error, results) => {
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      res.status(201).json(results.rows[0]);
    },
  );
});

// Rota para criar troca de molde
app.post("/api/planejamento/troca-molde", (req, res) => {
  const {
    id_maquina,
    id_molde_antigo,
    id_molde_novo,
    data_inicio,
    data_fim,
    descricao,
  } = req.body;

  pool.query(
    "INSERT INTO planejamento_producao (id_maquina, id_molde, id_molde_antigo, data_inicio, data_fim, tipo, descricao, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
    [
      id_maquina,
      id_molde_novo,
      id_molde_antigo,
      data_inicio,
      data_fim,
      "troca_molde",
      descricao,
      "planejado",
    ],
    (error, results) => {
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      res.status(201).json(results.rows[0]);
    },
  );
});
// Middleware de Erro
app.use((error, req, res, next) => {
  console.error("❌ Erro não tratado:", error.message);

  if (error.code === "ECONNRESET") {
    res.status(503).json({
      error: "Problema de conexão com o banco de dados",
      details: "Tente novamente em alguns instantes",
    });
  } else {
    res.status(500).json({
      error: "Erro interno do servidor",
      details:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Contate o administrador",
    });
  }
});

// Middleware para validar conflitos de agendamento
const validarConflitoAgendamento = async (req, res, next) => {
  const { id_maquina, data_inicio, data_fim } = req.body;

  try {
    const result = await pool.query(
      `SELECT id FROM planejamento_producao 
       WHERE id_maquina = $1 
       AND (
         ($2 BETWEEN data_inicio AND data_fim) OR
         ($3 BETWEEN data_inicio AND data_fim) OR
         (data_inicio BETWEEN $2 AND $3) OR
         (data_fim BETWEEN $2 AND $3)
       )
       AND status NOT IN ('cancelado', 'concluido')`,
      [id_maquina, data_inicio, data_fim],
    );

    if (result.rows.length > 0) {
      return res.status(409).json({
        error:
          "Conflito de agendamento: a máquina já está ocupada neste período",
      });
    }

    next();
  } catch (error) {
    console.error("Erro ao verificar conflito:", error);
    res.status(500).json({ error: "Erro ao verificar disponibilidade" });
  }
};
// Rotas para Manutenção
app.post(
  "/api/manutencoes",
  [
    body("descricao").notEmpty().withMessage("Descrição é obrigatória"),
    body("motivo").notEmpty().withMessage("Motivo é obrigatório"),
    validarConflitoAgendamento,
  ],
  async (req, res) => {
    const { id_maquina, data_inicio, data_fim, descricao, motivo } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO planejamento_producao (
        id_maquina, data_inicio, data_fim, tipo, descricao, motivo, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          id_maquina,
          data_inicio,
          data_fim,
          TIPOS_PLANEJAMENTO.MANUTENCAO,
          descricao,
          motivo,
          STATUS_PLANEJAMENTO.PLANEJADO,
          ...validarPlanejamento,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Erro ao agendar manutenção:", error);
      res.status(500).json({ error: "Erro ao agendar manutenção" });
    }
  },
);

app.get("/api/manutencoes", async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;

    let query = `
      SELECT p.*, m.descricao as maquina_descricao
      FROM planejamento_producao p
      JOIN maquinas m ON p.id_maquina = m.id
      WHERE p.tipo = $1
    `;

    const params = [TIPOS_PLANEJAMENTO.MANUTENCAO];

    if (data_inicio && data_fim) {
      query += ` AND p.data_inicio BETWEEN $2 AND $3`;
      params.push(data_inicio, data_fim);
    }

    query += " ORDER BY p.data_inicio";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao listar manutenções:", error);
    res.status(500).json({ error: "Erro ao listar manutenções" });
  }
});

// Rotas para Troca de Moldes
app.post(
  "/api/trocas-molde",
  [
    body("id_molde_novo")
      .isInt()
      .withMessage("ID do novo molde deve ser um número inteiro"),
    body("id_molde_antigo").optional().isInt(),
    validarConflitoAgendamento,
  ],
  async (req, res) => {
    const {
      id_maquina,
      id_molde_novo,
      id_molde_antigo,
      data_inicio,
      data_fim,
      descricao,
      ...validarPlanejamento
    } = req.body;

    try {
      // Verificar se o novo molde existe
      const molde = await pool.query("SELECT id FROM moldes WHERE id = $1", [
        id_molde_novo,
      ]);
      if (molde.rows.length === 0) {
        return res.status(404).json({ error: "Molde não encontrado" });
      }

      const result = await pool.query(
        `INSERT INTO planejamento_producao (
        id_maquina, id_molde, id_molde_antigo, data_inicio, data_fim, tipo, descricao, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          id_maquina,
          id_molde_novo,
          id_molde_antigo,
          data_inicio,
          data_fim,
          TIPOS_PLANEJAMENTO.TROCA_MOLDE,
          descricao ||
            `Troca de molde ${
              id_molde_antigo ? id_molde_antigo : ""
            } para ${id_molde_novo}`,
          STATUS_PLANEJAMENTO.PLANEJADO,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Erro ao agendar troca de molde:", error);
      res.status(500).json({ error: "Erro ao agendar troca de molde" });
    }
  },
);

app.get("/api/trocas-molde", async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;

    let query = `
      SELECT 
        p.*, 
        m.descricao as maquina_descricao,
        molde_novo.codigo as molde_novo_codigo,
        molde_novo.descricao as molde_novo_descricao,
        molde_antigo.codigo as molde_antigo_codigo,
        molde_antigo.descricao as molde_antigo_descricao
      FROM planejamento_producao p
      JOIN maquinas m ON p.id_maquina = m.id
      JOIN moldes molde_novo ON p.id_molde = molde_novo.id
      LEFT JOIN moldes molde_antigo ON p.id_molde_antigo = molde_antigo.id
      WHERE p.tipo = $1
    `;

    const params = [TIPOS_PLANEJAMENTO.TROCA_MOLDE];

    if (data_inicio && data_fim) {
      query += ` AND p.data_inicio BETWEEN $2 AND $3`;
      params.push(data_inicio, data_fim);
    }

    query += " ORDER BY p.data_inicio";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Erro ao listar trocas de molde:", error);
    res.status(500).json({ error: "Erro ao listar trocas de molde" });
  }
});

// Rotas de Planejamento de Produção
app.post(
  "/api/planejamento",
  [
    body("id_molde")
      .isInt()
      .withMessage("ID do molde deve ser um número inteiro"),
    body("id_maquina")
      .isInt()
      .withMessage("ID da máquina deve ser um número inteiro"),
    body("quantidade")
      .isInt({ min: 1 })
      .withMessage("Quantidade deve ser um número positivo"),
    body("data_inicio").isISO8601().withMessage("Data de início inválida"),
    body("turno")
      .optional()
      .isIn(["A", "B", "C"])
      .withMessage("Turno inválido"),
    validarConflitoAgendamento,
  ],
  async (req, res) => {
    const {
      id_molde,
      id_maquina,
      quantidade,
      data_inicio,
      turno,
      id_versao_molde,
      id_produto,
    } = req.body;

    try {
      // Verificar existência do molde
      const molde = await pool.query(
        "SELECT id, tempo_ciclo FROM moldes WHERE id = $1",
        [id_molde],
      );
      if (molde.rows.length === 0) {
        return res.status(404).json({ message: "Molde não encontrado" });
      }

      // Verificar existência da máquina
      const maquina = await pool.query(
        "SELECT id FROM maquinas WHERE id = $1",
        [id_maquina],
      );
      if (maquina.rows.length === 0) {
        return res.status(404).json({ message: "Máquina não encontrada" });
      }

      // Calcular tempo estimado (em minutos)
      const tempo_ciclo = molde.rows[0].tempo_ciclo || 30; // default 30 segundos
      const tempo_estimado = parseFloat(
        ((quantidade * tempo_ciclo) / 60).toFixed(2),
      );

      // Calcular data_fim
      const dataFim = new Date(
        new Date(data_inicio).getTime() + tempo_estimado * 60000,
      );

      // Inserir no banco de dados
      const result = await pool.query(
        `INSERT INTO planejamento_producao (
        id_molde, id_maquina, quantidade, tempo_estimado, 
        data_inicio, data_fim, status, tipo, turno,
        id_versao_molde, id_produto
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
        [
          id_molde,
          id_maquina,
          quantidade,
          tempo_estimado,
          new Date(data_inicio),
          dataFim,
          STATUS_PLANEJAMENTO.PLANEJADO,
          TIPOS_PLANEJAMENTO.PRODUCAO,
          turno,
          id_versao_molde,
          id_produto,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao criar planejamento:", err);

      if (err.code === "23503") {
        return res.status(400).json({
          message: "Erro de referência - verifique os IDs de molde e máquina",
        });
      }

      res.status(500).json({
        message: "Erro ao criar planejamento",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  },
);

// Rota para calcular tempo de produção
app.get("/api/planejamento/calcular-tempo", async (req, res) => {
  const { id_molde, quantidade } = req.query;

  if (!id_molde || !quantidade) {
    return res
      .status(400)
      .json({ message: "Parâmetros id_molde e quantidade são obrigatórios" });
  }

  try {
    const molde = await pool.query(
      "SELECT tempo_ciclo FROM moldes WHERE id = $1",
      [id_molde],
    );
    if (molde.rows.length === 0) {
      return res.status(404).json({ message: "Molde não encontrado" });
    }

    const tempo_ciclo = molde.rows[0].tempo_ciclo || 30; // default 30 segundos
    const tempo_estimado = parseFloat(
      ((parseInt(quantity) * tempo_ciclo) / 60).toFixed(2),
    );

    res.json({ tempo_estimado });
  } catch (err) {
    console.error("Erro ao calcular tempo:", err);
    res.status(500).json({ message: "Erro ao calcular tempo" });
  }
});

// Rota para atualizar status (funciona para produção, manutenção e troca de molde)
app.patch(
  "/api/planejamento/:id/status",
  [
    body("status")
      .isIn(Object.values(STATUS_PLANEJAMENTO))
      .withMessage("Status inválido"),
  ],
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Verificar se o planejamento existe
      const planejamento = await pool.query(
        "SELECT id, status FROM planejamento_producao WHERE id = $1",
        [id],
      );

      if (planejamento.rows.length === 0) {
        return res.status(404).json({ message: "Planejamento não encontrado" });
      }

      const statusAtual = planejamento.rows[0].status;

      // Atualizar status
      const result = await pool.query(
        "UPDATE planejamento_producao SET status = $1 WHERE id = $2 RETURNING *",
        [status, id],
      );

      res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error("Erro ao atualizar status:", err);
      res.status(500).json({ message: "Erro ao atualizar status" });
    }
  },
);

// Rota para listar todos os agendamentos (produção, manutenção e troca de molde)
app.get("/api/agendamentos", async (req, res) => {
  const { data_inicio, data_fim, tipo, status } = req.query;

  try {
    let query = `
      SELECT 
        p.*,
        m.descricao as maquina_descricao,
        mol.codigo as molde_codigo,
        mol.descricao as molde_descricao,
        mol_antigo.codigo as molde_antigo_codigo,
        mol_antigo.descricao as molde_antigo_descricao,
        pr.referencia_produto,
        pr.ds_produto as produto_descricao
      FROM planejamento_producao p
      JOIN maquinas m ON p.id_maquina = m.id
      LEFT JOIN moldes mol ON p.id_molde = mol.id
      LEFT JOIN moldes mol_antigo ON p.id_molde_antigo = mol_antigo.id
      LEFT JOIN produtos pr ON p.id_produto = pr.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (data_inicio && data_fim) {
      query += ` AND p.data_inicio BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(data_inicio, data_fim);
    }

    if (tipo) {
      query += ` AND p.tipo = $${paramIndex++}`;
      params.push(tipo);
    }

    if (status) {
      query += ` AND p.status = $${paramIndex++}`;
      params.push(status);
    }

    query += " ORDER BY p.data_inicio";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Erro ao listar agendamentos:", err);
    res.status(500).json({ message: "Erro ao listar agendamentos" });
  }
});

// Rotas para Tipos de Manutenção
const manutencaoRouter = express.Router();

// Listar todos os tipos de manutenção
manutencaoRouter.get("/tipos", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tipos_manutencao WHERE ativo = true ORDER BY categoria, descricao",
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar tipos de manutenção" });
  }
});

// Criar novo tipo de manutenção
manutencaoRouter.post(
  "/tipos",
  autenticarToken,
  [
    body("descricao").notEmpty(),
    body("categoria").notEmpty(),
    body("tempo_estimado_minutos").isInt({ min: 1 }),
    body("prioridade").optional().isInt({ min: 1, max: 5 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      descricao,
      categoria,
      tempo_estimado_minutos,
      prioridade = 3,
    } = req.body;

    try {
      const result = await pool.query(
        `INSERT INTO tipos_manutencao 
       (descricao, categoria, tempo_estimado_minutos, prioridade) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
        [descricao, categoria, tempo_estimado_minutos, prioridade],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao criar tipo de manutenção" });
    }
  },
);

// Rotas para Agendamento de Manutenção
manutencaoRouter.post(
  "/agendar",
  autenticarToken,
  [
    body("id_maquina").isInt(),
    body("id_tipo_manutencao").isInt(),
    body("data_inicio").isISO8601(),
    body("data_fim").isISO8601(),
    body("id_operador_responsavel").optional().isInt(),
    body("observacoes").optional().isString(),
    validarConflitoAgendamento,
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      id_maquina,
      id_tipo_manutencao,
      data_inicio,
      data_fim,
      id_operador_responsavel,
      observacoes,
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Criar planejamento
      const tipoManutencao = await client.query(
        "SELECT descricao FROM tipos_manutencao WHERE id = $1",
        [id_tipo_manutencao],
      );

      if (tipoManutencao.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ message: "Tipo de manutenção não encontrado" });
      }

      const descricao = `Manutenção: ${tipoManutencao.rows[0].descricao}`;

      const planejamento = await client.query(
        `INSERT INTO planejamento_producao (
        id_maquina, data_inicio, data_fim, tipo, descricao, status
      ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          id_maquina,
          data_inicio,
          data_fim,
          TIPOS_PLANEJAMENTO.MANUTENCAO,
          descricao,
          STATUS_PLANEJAMENTO.PLANEJADO,
        ],
      );

      // 2. Registrar histórico de manutenção
      const historico = await client.query(
        `INSERT INTO historico_manutencoes (
        id_planejamento, id_tipo_manutencao, id_operador_responsavel, observacoes, status
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          planejamento.rows[0].id,
          id_tipo_manutencao,
          id_operador_responsavel,
          observacoes,
          "planejada",
        ],
      );

      await client.query("COMMIT");
      res.status(201).json({
        planejamento: planejamento.rows[0],
        manutencao: historico.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ message: "Erro ao agendar manutenção" });
    } finally {
      client.release();
    }
  },
);

// Rotas para Execução de Manutenção
manutencaoRouter.post("/:id/iniciar", autenticarToken, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("BEGIN");

    // Atualizar status do planejamento
    const planejamento = await pool.query(
      `UPDATE planejamento_producao 
       SET status = $1 
       WHERE id = $2 AND status = $3
       RETURNING *`,
      [STATUS_PLANEJAMENTO.EM_ANDAMENTO, id, STATUS_PLANEJAMENTO.PLANEJADO],
    );

    if (planejamento.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "Manutenção não pode ser iniciada" });
    }

    // Atualizar histórico
    const historico = await pool.query(
      `UPDATE historico_manutencoes 
       SET status = $1, data_real_inicio = NOW() 
       WHERE id_planejamento = $2 AND status = $3
       RETURNING *`,
      ["em_andamento", id, "planejada"],
    );

    await pool.query("COMMIT");
    res.status(200).json({
      planejamento: planejamento.rows[0],
      manutencao: historico.rows[0],
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Erro ao iniciar manutenção" });
  }
});

// Finalizar manutenção
manutencaoRouter.post(
  "/:id/finalizar",
  autenticarToken,
  [
    body("pecas_substituidas").optional().isString(),
    body("custo_estimado").optional().isNumeric(),
    body("checklist").optional().isJSON(),
  ],
  async (req, res) => {
    const { id } = req.params;
    const { pecas_substituidas, custo_estimado, checklist } = req.body;

    try {
      await pool.query("BEGIN");

      // Atualizar status do planejamento
      const planejamento = await pool.query(
        `UPDATE planejamento_producao 
       SET status = $1 
       WHERE id = $2 AND status = $3
       RETURNING *`,
        [STATUS_PLANEJAMENTO.CONCLUIDO, id, STATUS_PLANEJAMENTO.EM_ANDAMENTO],
      );

      if (planejamento.rows.length === 0) {
        await pool.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "Manutenção não pode ser finalizada" });
      }

      // Atualizar histórico
      const historico = await pool.query(
        `UPDATE historico_manutencoes 
       SET 
         status = $1, 
         data_real_fim = NOW(),
         pecas_substituidas = $2,
         custo_estimado = $3,
         checklist = $4
       WHERE id_planejamento = $5 AND status = $6
       RETURNING *`,
        [
          "concluida",
          pecas_substituidas,
          custo_estimado,
          checklist,
          id,
          "em_andamento",
        ],
      );

      await pool.query("COMMIT");
      res.status(200).json({
        planejamento: planejamento.rows[0],
        manutencao: historico.rows[0],
      });
    } catch (err) {
      await pool.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ message: "Erro ao finalizar manutenção" });
    }
  },
);

// Listar manutenções
manutencaoRouter.get("/", autenticarToken, async (req, res) => {
  try {
    const { status, id_maquina, data_inicio, data_fim } = req.query;

    let query = `
      SELECT 
        hm.*,
        pp.id_maquina,
        pp.data_inicio as data_planejada_inicio,
        pp.data_fim as data_planejada_fim,
        pp.descricao,
        m.descricao as maquina_descricao,
        tm.descricao as tipo_manutencao_descricao,
        tm.categoria,
        tm.tempo_estimado_minutos,
        o.nome as operador_responsavel_nome
      FROM historico_manutencoes hm
      JOIN planejamento_producao pp ON hm.id_planejamento = pp.id
      JOIN tipos_manutencao tm ON hm.id_tipo_manutencao = tm.id
      JOIN maquinas m ON pp.id_maquina = m.id
      LEFT JOIN operadores o ON hm.id_operador_responsavel = o.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND hm.status = $${paramIndex++}`;
      params.push(status);
    }

    if (id_maquina) {
      query += ` AND pp.id_maquina = $${paramIndex++}`;
      params.push(id_maquina);
    }

    if (data_inicio && data_fim) {
      query += ` AND pp.data_inicio BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(data_inicio, data_fim);
    }

    query += " ORDER BY pp.data_inicio DESC";

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar manutenções" });
  }
});

// Montar as rotas no app principal
app.use("/manutencao", manutencaoRouter);

// Rotas para Checklist de Manutenção
manutencaoRouter.get(
  "/checklists/:tipo_manutencao_id",
  autenticarToken,
  async (req, res) => {
    const { tipo_manutencao_id } = req.params;

    try {
      // Aqui você pode implementar a lógica para retornar um checklist padrão
      // baseado no tipo de manutenção
      const checklistPadrao = {
        itens: [
          {
            descricao: "Verificar pressão hidráulica",
            tipo: "verificacao",
            obrigatorio: true,
          },
          {
            descricao: "Lubrificar eixos",
            tipo: "acao",
            obrigatorio: true,
          },
          {
            descricao: "Substituir filtros",
            tipo: "acao",
            obrigatorio: false,
          },
        ],
      };

      res.status(200).json(checklistPadrao);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao buscar checklist" });
    }
  },
);

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
  console.error(err.stack);

  // Registrar erro no banco de dados
  registrarErro("Erro no servidor", err).catch((e) =>
    console.error("Falha ao registrar erro:", e),
  );

  res.status(500).json({
    message: "Erro interno no servidor",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Middleware para validar dados básicos de planejamento
const validarPlanejamento = [
  body("id_maquina")
    .isInt()
    .withMessage("ID da máquina deve ser um número inteiro"),
  body("data_inicio").isISO8601().withMessage("Data de início inválida"),
  body("data_fim").isISO8601().withMessage("Data de fim inválida"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
];

// Função para consultar a API Gemini
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializa o Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function consultarGemini(prompt) {
  try {
    // Obtém o modelo Gemini Pro
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent({
      contents: [
        {
          parts: [
            {
              text: `Você é um assistente para operadores de produção industrial. Seja claro, conciso e objetivo.
                 Responda em português brasileiro.
                 Pergunta: ${prompt}`,
            },
          ],
        },
      ],
    });

    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Erro na API Gemini:", error);
    throw new Error(`Erro ao consultar Gemini: ${error.message}`);
  }
}

// Rota para obter histórico
app.get("/api/ia/historico", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pergunta, resposta 
       FROM consultas_ia 
       WHERE id_operador = $1
       ORDER BY data_consulta DESC
       LIMIT 10`,
      [req.user.id],
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

// Rota para feedback
app.post("/api/ia/feedback", autenticarToken, async (req, res) => {
  try {
    const { pergunta, util } = req.body;

    await pool.query(
      `UPDATE consultas_ia SET foi_util = $1
       WHERE id_operador = $2 AND pergunta = $3`,
      [util, req.user.id, pergunta],
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erro ao registrar feedback" });
  }
});

// Rota para servir a página
app.get("/ajuda-ia", autenticarToken, (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "src/app/pages/ui-componentsia-ajuda",
      "ia-ajuda.html",
    ),
  );
});

app.post(
  "/api/token/device",
  [body("device_id").notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const token = jwt.sign(
      {
        device: req.body.device_id,
        role: "device",
      },
      process.env.SECRET_KEY || "secreto",
      { expiresIn: "30d" },
    );

    res.json({ token });
  },
);

router.get("/contagem/por-estrutura/:idInventario", async (req, res) => {
  let clientPool, clientPoolSeven;

  try {
    const { idInventario } = req.params;
    const { id_local_estoque } = req.query;

    clientPool = await pool.connect();
    clientPoolSeven = await poolSeven.connect();

    // Query da estrutura com filtro de local de estoque
    let estruturaQuery = `
      SELECT 
        r.id as rua_id,
        r.codigo as rua_codigo,
        m.id as modulo_id,
        m.codigo as modulo_codigo,
        n.id as nivel_id,
        n.codigo as nivel_codigo,
        p.id as posicao_id,
        p.codigo as posicao_codigo,
        p.id_local_estoque,
        le.codigo as local_estoque_codigo,
        le.descricao as local_estoque_descricao,
        COALESCE(SUM(COALESCE(ce.quantidade_consumo::numeric, ce.quantidade_pacotes::numeric)), 0) as quantidade_total,
        (
          SELECT json_agg(
            json_build_object(
              'id_produto', itens_agg.id_produto,
              'ds_produto', COALESCE(pc.descricao, 'Produto ' || itens_agg.id_produto),
              'referencia', COALESCE(pc.referencia, 'N/A'),
              'quantidade', itens_agg.quantidade_total
            )
          )
          FROM (
            SELECT
              ce2.id_produto,
              SUM(COALESCE(ce2.quantidade_consumo::numeric, ce2.quantidade_pacotes::numeric)) AS quantidade_total
            FROM contagem_estoque ce2
            WHERE ce2.id_posicao = p.id
              AND ce2.id_produto IS NOT NULL
              AND ce2.id_inventario = $1
              ${id_local_estoque ? "AND ce2.id_local_estoque = $2" : ""}
            GROUP BY ce2.id_produto
            HAVING SUM(COALESCE(ce2.quantidade_consumo::numeric, ce2.quantidade_pacotes::numeric)) > 0
          ) itens_agg
          LEFT JOIN produtos_cache pc ON itens_agg.id_produto = pc.id
        ) as itens
      FROM ruas r
      JOIN modulos m ON m.id_rua = r.id
      JOIN niveis n ON n.id_modulo = m.id
      JOIN posicoes p ON p.id_nivel = n.id
      LEFT JOIN locais_estoque le ON p.id_local_estoque = le.id
      LEFT JOIN contagem_estoque ce ON ce.id_posicao = p.id AND ce.id_inventario = $1
      LEFT JOIN produtos_cache pc ON ce.id_produto = pc.id
      WHERE 1=1
      ${id_local_estoque ? "AND p.id_local_estoque = $2" : ""}
      GROUP BY 
        r.id, r.codigo,
        m.id, m.codigo,
        n.id, n.codigo,
        p.id, p.codigo, p.id_local_estoque,
        le.codigo, le.descricao
      ORDER BY 
        r.codigo, 
        m.codigo, 
        n.codigo, 
        p.codigo
    `;

    const estruturaParams = [idInventario];
    if (id_local_estoque) {
      estruturaParams.push(id_local_estoque);
    }

    const estruturaResult = await clientPool.query(
      estruturaQuery,
      estruturaParams,
    );

    // Query dos produtos com filtro de local de estoque
    let contagensQuery = `
      SELECT 
        c.id_produto,
        c.id_local_estoque,
        le.codigo as local_estoque_codigo,
        le.descricao as local_estoque_descricao,
        SUM(COALESCE(c.quantidade_consumo::numeric, c.quantidade_pacotes::numeric)) as quantidade_total,
        (
          SELECT json_agg(
            json_build_object(
              'codigo_endereco', enderecos_agg.codigo_endereco,
              'quantidade', enderecos_agg.quantidade_total
            )
          )
          FROM (
            SELECT
              CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) AS codigo_endereco,
              SUM(COALESCE(c2.quantidade_consumo::numeric, c2.quantidade_pacotes::numeric)) AS quantidade_total
            FROM contagem_estoque c2
            JOIN posicoes p ON c2.id_posicao = p.id
            JOIN niveis n ON p.id_nivel = n.id
            JOIN modulos m ON n.id_modulo = m.id
            JOIN ruas r ON m.id_rua = r.id
            WHERE c2.id_produto = c.id_produto
              AND c2.id_inventario = $1
              ${id_local_estoque ? "AND c2.id_local_estoque = $2" : ""}
            GROUP BY CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo)
            HAVING SUM(COALESCE(c2.quantidade_consumo::numeric, c2.quantidade_pacotes::numeric)) > 0
          ) enderecos_agg
        ) as enderecos
      FROM contagem_estoque c
      LEFT JOIN locais_estoque le ON c.id_local_estoque = le.id
      WHERE c.id_produto IS NOT NULL
      AND c.id_inventario = $1
      ${id_local_estoque ? "AND c.id_local_estoque = $2" : ""}
      GROUP BY c.id_produto, c.id_local_estoque, le.codigo, le.descricao
      HAVING SUM(COALESCE(c.quantidade_consumo::numeric, c.quantidade_pacotes::numeric)) > 0
    `;

    const contagensParams = [idInventario];
    if (id_local_estoque) {
      contagensParams.push(id_local_estoque);
    }

    const contagensResult = await clientPool.query(
      contagensQuery,
      contagensParams,
    );

    if (contagensResult.rowCount === 0) {
      return res.json({
        estrutura: estruturaResult.rows,
        produtos: [],
      });
    }

    // Buscar informações dos produtos
    const produtosIds = contagensResult.rows.map((row) => row.id_produto);
    const produtosQuery = `
      SELECT 
        produtoid AS id,
        ds_produto,
        referencia_produto AS referencia
      FROM produto
      WHERE produtoid = ANY($1::int[])
    `;

    const produtosResult = await clientPoolSeven.query(produtosQuery, [
      produtosIds,
    ]);

    // Combinar os resultados
    const produtosDashboard = contagensResult.rows.map((contagem) => {
      const produto = produtosResult.rows.find(
        (p) => p.id == contagem.id_produto,
      ) || {
        ds_produto: `Produto ID ${contagem.id_produto}`,
        referencia: "N/A",
      };

      return {
        ds_produto: produto.ds_produto,
        referencia: produto.referencia,
        quantidade_total: contagem.quantidade_total,
        enderecos: contagem.enderecos || [],
        id_local_estoque: contagem.id_local_estoque,
        local_estoque_codigo: contagem.local_estoque_codigo,
        local_estoque_descricao: contagem.local_estoque_descricao,
      };
    });

    res.json({
      estrutura: estruturaResult.rows,
      produtos: produtosDashboard,
    });
  } catch (error) {
    console.error("Erro detalhado:", error);
    res.status(500).json({
      error: "Erro ao processar a requisição",
      details: process.env.NODE_ENV === "development" ? error.message : null,
    });
  } finally {
    if (clientPool) clientPool.release();
    if (clientPoolSeven) clientPoolSeven.release();
  }
});

// server.js - Novas rotas adaptadas
app.post(
  "/api/estoque/entrada-com-unidades",
  autenticarToken,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const {
        produto_id,
        posicao_id,
        quantidade_entrada,
        id_unidade_entrada,
        id_local_estoque,
        lote,
        observacao,
        id_operador,
      } = req.body;

      // 1. Buscar informações do produto
      const produtoResult = await client.query(
        `
      SELECT p.*, 
             u_entrada.codigo as unidade_entrada_codigo,
             u_consumo.codigo as unidade_consumo_codigo,
             p.fator_conversao_compra_consumo
      FROM produtos p
      LEFT JOIN unidades u_entrada ON p.id_unidade_compra = u_entrada.id
      LEFT JOIN unidades u_consumo ON p.id_unidade_consumo = u_consumo.id
      WHERE p.id = $1
    `,
        [produto_id],
      );

      if (produtoResult.rows.length === 0) {
        throw new Error("Produto não encontrado");
      }

      const produto = produtoResult.rows[0];

      // 2. Validar unidade de entrada
      if (produto.id_unidade_compra !== id_unidade_entrada) {
        throw new Error(
          `Unidade de entrada deve ser ${produto.unidade_entrada_codigo}`,
        );
      }

      // 3. Calcular quantidade em unidade de consumo
      const quantidade_consumo =
        quantidade_entrada * produto.fator_conversao_compra_consumo;
      const quantidade_original = quantidade_entrada; // Mantém a quantidade original

      // 4. Buscar/atualizar estoque
      const estoqueResult = await client.query(
        `
      SELECT * FROM estoque 
      WHERE produto_id = $1 AND posicao_id = $2 AND id_local_estoque = $3
    `,
        [produto_id, posicao_id, id_local_estoque],
      );

      if (estoqueResult.rows.length > 0) {
        // Atualizar estoque existente
        const estoque = estoqueResult.rows[0];
        const nova_quantidade_original =
          estoque.quantidade + quantidade_original;
        const nova_quantidade_consumo =
          (estoque.quantidade_consumo ||
            estoque.quantidade * produto.fator_conversao_compra_consumo) +
          quantidade_consumo;

        await client.query(
          `
        UPDATE estoque 
        SET quantidade = $1, quantidade_consumo = $2, data_atualizacao = CURRENT_TIMESTAMP, operador_id = $3
        WHERE id = $4
      `,
          [
            nova_quantidade_original,
            nova_quantidade_consumo,
            id_operador,
            estoque.id,
          ],
        );
      } else {
        // Inserir novo registro de estoque
        await client.query(
          `
        INSERT INTO estoque (produto_id, posicao_id, quantidade, quantidade_consumo, id_unidade_consumo, data_atualizacao, operador_id, id_local_estoque)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7)
      `,
          [
            produto_id,
            posicao_id,
            quantidade_original,
            quantidade_consumo,
            produto.id_unidade_consumo,
            id_operador,
            id_local_estoque,
          ],
        );
      }

      // 5. Registrar movimentação
      await client.query(
        `
      INSERT INTO movimentacoes_estoque (
        tipo_movimentacao_id, produto_id, posicao_id, quantidade, quantidade_entrada, quantidade_consumo,
        id_unidade_entrada, id_unidade_consumo, operador_id, observacao, documento
      ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'ENTRADA_COMPRA')
    `,
        [
          produto_id,
          posicao_id,
          quantidade_original,
          quantidade_entrada,
          quantidade_consumo,
          id_unidade_entrada,
          produto.id_unidade_consumo,
          id_operador,
          observacao,
        ],
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: `Entrada registrada: ${quantidade_entrada} ${produto.unidade_entrada_codigo} = ${quantidade_consumo} ${produto.unidade_consumo_codigo}`,
        quantidade_original: quantidade_original,
        quantidade_consumo: quantidade_consumo,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao registrar entrada:", error);
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  },
);

app.post(
  "/api/estoque/saida-com-unidades",
  autenticarToken,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const {
        produto_id,
        posicao_id,
        quantidade_saida,
        id_unidade_saida,
        id_local_estoque,
        observacao,
        id_operador,
      } = req.body;

      // 1. Buscar informações do produto e estoque
      const estoqueResult = await client.query(
        `
      SELECT e.*, p.*, 
             u_consumo.codigo as unidade_consumo_codigo,
             u_consumo.id as id_unidade_consumo
      FROM estoque e
      JOIN produtos p ON e.produto_id = p.id
      JOIN unidades u_consumo ON COALESCE(e.id_unidade_consumo, p.id_unidade_consumo, 1) = u_consumo.id
      WHERE e.produto_id = $1 AND e.posicao_id = $2 AND e.id_local_estoque = $3
    `,
        [produto_id, posicao_id, id_local_estoque],
      );

      if (estoqueResult.rows.length === 0) {
        throw new Error(
          "Produto não encontrado no estoque da posição selecionada",
        );
      }

      const estoque = estoqueResult.rows[0];

      // 2. Validar unidade de saída
      if (estoque.id_unidade_consumo !== id_unidade_saida) {
        throw new Error(
          `Unidade de saída deve ser ${estoque.unidade_consumo_codigo}`,
        );
      }

      // 3. Calcular quantidades para baixa
      const quantidade_consumo_atual =
        estoque.quantidade_consumo ||
        estoque.quantidade * estoque.fator_conversao_compra_consumo;

      if (quantidade_consumo_atual < quantidade_saida) {
        throw new Error(
          `Saldo insuficiente. Disponível: ${quantidade_consumo_atual} ${estoque.unidade_consumo_codigo}`,
        );
      }

      // 4. Calcular nova quantidade original (pacotes) baseada no consumo
      const nova_quantidade_consumo =
        quantidade_consumo_atual - quantidade_saida;
      const nova_quantidade_original =
        nova_quantidade_consumo / estoque.fator_conversao_compra_consumo;

      // 5. Atualizar estoque
      await client.query(
        `
      UPDATE estoque 
      SET quantidade = $1, quantidade_consumo = $2, data_atualizacao = CURRENT_TIMESTAMP, operador_id = $3
      WHERE id = $4
    `,
        [
          nova_quantidade_original,
          nova_quantidade_consumo,
          id_operador,
          estoque.id,
        ],
      );

      // 6. Registrar movimentação (tipo 2 = saída)
      await client.query(
        `
      INSERT INTO movimentacoes_estoque (
        tipo_movimentacao_id, produto_id, posicao_id, quantidade, quantidade_consumo,
        id_unidade_consumo, operador_id, observacao, documento
      ) VALUES (2, $1, $2, $3, $4, $5, $6, $7, 'SAIDA_CONSUMO')
    `,
        [
          produto_id,
          posicao_id,
          -quantidade_saida / estoque.fator_conversao_compra_consumo,
          quantidade_saida,
          id_unidade_saida,
          id_operador,
          observacao,
        ],
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: `Saída registrada: ${quantidade_saida} ${estoque.unidade_consumo_codigo}`,
        nova_quantidade_original: nova_quantidade_original,
        nova_quantidade_consumo: nova_quantidade_consumo,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao registrar saída:", error);
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  },
);

// Rota para buscar posições por local de estoque - CORRIGIDA
app.get(
  "/api/estoque/posicoes/por-local/:id_local_estoque",
  async (req, res) => {
    try {
      const { id_local_estoque } = req.params;

      console.log(`📍 Buscando posições para local: ${id_local_estoque}`);

      const result = await pool.query(
        `
      SELECT 
        p.id,
        p.codigo as posicao,
        p.descricao,
        p.codigo_barras,
        p.local_estoque,
        p.id_local_estoque,
        r.codigo as rua,
        m.codigo as modulo,
        n.codigo as nivel
      FROM posicoes p
      JOIN niveis n ON p.id_nivel = n.id
      JOIN modulos m ON n.id_modulo = m.id
      JOIN ruas r ON m.id_rua = r.id
      WHERE p.id_local_estoque = $1
      ORDER BY r.codigo, m.codigo, n.codigo, p.codigo
    `,
        [id_local_estoque],
      );

      console.log(
        `📍 Encontradas ${result.rows.length} posições para local ${id_local_estoque}`,
      );

      // Log das primeiras posições para debug
      if (result.rows.length > 0) {
        console.log("📍 Primeiras 3 posições:", result.rows.slice(0, 3));
      }

      res.json(result.rows);
    } catch (error) {
      console.error("❌ Erro ao buscar posições por local:", error);
      res.status(500).json({ error: "Erro ao buscar posições" });
    }
  },
);

// Rota para buscar contagens por inventário e local
app.get("/api/enderecamento/inventario/:id/contagens", async (req, res) => {
  try {
    const { id } = req.params;
    const { id_local_estoque } = req.query;

    let query = `
      SELECT 
        ce.*,
        pc.descricao as produto_descricao,
        pc.referencia,
        r.codigo as rua_codigo,
        m.codigo as modulo_codigo,
        n.codigo as nivel_codigo,
        p.codigo as posicao_codigo,
        le.codigo as local_estoque_codigo,
        le.descricao as local_estoque_descricao
      FROM contagem_estoque ce
      LEFT JOIN produtos_cache pc ON ce.id_produto = pc.id
      LEFT JOIN posicoes p ON ce.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN locais_estoque le ON ce.id_local_estoque = le.id
      WHERE ce.id_inventario = $1
    `;

    const params = [id];

    if (id_local_estoque) {
      query += " AND ce.id_local_estoque = $2";
      params.push(id_local_estoque);
    }

    query += " ORDER BY ce.data_contagem DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar contagens:", error);
    res.status(500).json({ error: "Erro ao buscar contagens" });
  }
});

// Rota para listar inventários disponíveis
router.get("/inventario", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, mes_referencia, status, 
             data_abertura, data_fechamento,
             id_operador_abertura, id_operador_fechamento
      FROM inventario
      ORDER BY data_abertura DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar inventários:", error);
    res.status(500).json({ error: "Erro ao buscar inventários" });
  }
});

// Rotas para estrutura hierárquica
app.get("/api/enderecamento/ruas", async (req, res) => {
  try {
    const { id_local_estoque } = req.query;

    let query = "SELECT * FROM ruas WHERE 1=1";
    const params = [];

    // Só filtra se id_local_estoque for fornecido e for um número válido
    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND id IN (
        SELECT DISTINCT m.id_rua 
        FROM modulos m 
        JOIN niveis n ON m.id = n.id_modulo 
        JOIN posicoes p ON n.id = p.id_nivel 
        WHERE p.id_local_estoque = $1
      )`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar ruas:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/enderecamento/ruas/:id_rua/modulos", async (req, res) => {
  try {
    const { id_rua } = req.params;
    const { id_local_estoque } = req.query;

    let query = "SELECT * FROM modulos WHERE id_rua = $1";
    const params = [id_rua];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND id IN (
        SELECT DISTINCT n.id_modulo 
        FROM niveis n 
        JOIN posicoes p ON n.id = p.id_nivel 
        WHERE p.id_local_estoque = $2
      )`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar módulos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/enderecamento/modulos/:id_modulo/niveis", async (req, res) => {
  try {
    const { id_modulo } = req.params;
    const { id_local_estoque } = req.query;

    let query = "SELECT * FROM niveis WHERE id_modulo = $1";
    const params = [id_modulo];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND id IN (
        SELECT DISTINCT p.id_nivel 
        FROM posicoes p 
        WHERE p.id_local_estoque = $2
      )`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar níveis:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/enderecamento/niveis/:id_nivel/posicoes", async (req, res) => {
  try {
    const { id_nivel } = req.params;
    const { id_local_estoque } = req.query;

    let query = "SELECT * FROM posicoes WHERE id_nivel = $1";
    const params = [id_nivel];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += " AND id_local_estoque = $2";
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar posições:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rotas para locais de estoque
app.get("/api/enderecamento/locais-estoque", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM locais_estoque WHERE ativo = true ORDER BY codigo",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar locais de estoque:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota para registrar contagem (versão restaurada para comportamento anterior)
app.post("/api/enderecamento/contagem", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      id_inventario,
      id_produto,
      id_posicao,
      quantidade_pacotes,
      id_operador,
      lote,
      observacao,
      id_local_estoque,
    } = req.body;

    // Validação mínima: quantidade_pacotes requerida e numérica
    if (
      quantidade_pacotes === undefined ||
      quantidade_pacotes === null ||
      isNaN(Number(quantidade_pacotes))
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "quantidade_pacotes é obrigatória e deve ser numérica.",
      });
    }

    const quantidade = Number(quantidade_pacotes);

    // Verificar se já existe contagem para este produto/posição/local no inventário
    const contagemExistente = await client.query(
      `SELECT id, quantidade_pacotes FROM contagem_estoque WHERE id_inventario = $1 AND id_produto = $2 AND id_posicao = $3 AND id_local_estoque = $4`,
      [id_inventario, id_produto, id_posicao, id_local_estoque],
    );

    const quantidadeAnterior = contagemExistente.rows.length > 0
      ? Number(contagemExistente.rows[0].quantidade_pacotes || 0)
      : 0;

    let result;
    if (contagemExistente.rows.length > 0) {
      await definirContextoAuditoriaEstoque(client, {
        id_operador,
        origem_modulo: "ENDERECAMENTO_CONTAGEM",
        origem_tipo: "CONTAGEM_ESTOQUE",
        referencia_movimento: "CONTAGEM_ESTOQUE",
        id_referencia: contagemExistente.rows[0].id,
        observacao: observacao || lote || null,
      });

      // Atualiza a contagem existente apenas com quantidade_pacotes
      result = await client.query(
        `UPDATE contagem_estoque SET quantidade_pacotes = $1, data_contagem = NOW(), id_operador = $2, lote = $3, observacao = $4 WHERE id = $5 RETURNING *`,
        [
          quantidade,
          id_operador,
          lote,
          observacao,
          contagemExistente.rows[0].id,
        ],
      );
    } else {
      await definirContextoAuditoriaEstoque(client, {
        id_operador,
        origem_modulo: "ENDERECAMENTO_CONTAGEM",
        origem_tipo: "CONTAGEM_ESTOQUE",
        referencia_movimento: "CONTAGEM_ESTOQUE",
        observacao: observacao || lote || null,
      });

      // Insere nova contagem usando apenas quantidade_pacotes
      result = await client.query(
        `INSERT INTO contagem_estoque (id_inventario, id_produto, id_posicao, quantidade_pacotes, id_operador, lote, observacao, id_local_estoque, data_contagem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
        [
          id_inventario,
          id_produto,
          id_posicao,
          quantidade,
          id_operador,
          lote,
          observacao,
          id_local_estoque,
        ],
      );
    }

    const quantidadeNova = Number(result.rows[0]?.quantidade_pacotes || 0);
    const diferenca = quantidadeNova - quantidadeAnterior;

    if (diferenca !== 0) {
      await registrarMovimentacaoEstoque(client, {
        tipo_movimentacao: diferenca > 0 ? "ENTRADA" : "AJUSTE",
        id_produto,
        id_posicao_origem: diferenca < 0 ? id_posicao : null,
        id_posicao_destino: diferenca > 0 ? id_posicao : null,
        quantidade: Math.abs(diferenca),
        id_operador,
        modulo_origem: "ENDERECAMENTO_CONTAGEM",
        referencia_movimento: "CONTAGEM_ESTOQUE",
        id_referencia: result.rows[0]?.id || null,
        observacao: observacao || lote || null,
      });
    }

    await client.query("COMMIT");
    res.json({
      message: "Contagem registrada com sucesso",
      contagem: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao registrar contagem:", error);
    res
      .status(500)
      .json({ error: "Erro ao registrar contagem", details: error.message });
  } finally {
    client.release();
  }
});

app.use("/api/enderecamento", router);
// Rota para obter dados consolidados
router.get("/contagem/consolidado", async (req, res) => {
  let clientPool, clientPoolSeven;

  try {
    clientPool = await pool.connect();
    clientPoolSeven = await poolSeven.connect();

    // 1. Buscar contagens agrupadas por produto
    const contagensQuery = `
      SELECT 
        c.id_produto,
        SUM(COALESCE(c.quantidade_consumo::numeric, c.quantidade_pacotes::numeric)) as quantidade_total,
        json_agg(
          json_build_object(
            'codigo_endereco', CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo),
            'quantidade', COALESCE(c.quantidade_consumo, c.quantidade_pacotes)
          )
        ) as enderecos
      FROM contagem_estoque c
      JOIN posicoes p ON c.id_posicao = p.id
      JOIN niveis n ON p.id_nivel = n.id
      JOIN modulos m ON n.id_modulo = m.id
      JOIN ruas r ON m.id_rua = r.id
      WHERE c.id_produto IS NOT NULL
      GROUP BY c.id_produto
    `;

    const contagensResult = await clientPool.query(contagensQuery);
    console.log(
      `Encontradas ${contagensResult.rowCount} contagens de produtos`,
    );

    if (contagensResult.rowCount === 0) {
      return res.json([]);
    }

    // 2. Converter IDs para números para a consulta no outro banco
    const produtosIds = contagensResult.rows.map((row) =>
      parseInt(row.id_produto),
    );

    // 3. Buscar informações dos produtos
    const produtosQuery = `
      SELECT 
        produtoid AS id,
        ds_produto,
        referencia_produto AS referencia
      FROM produto
      WHERE produtoid = ANY($1)
    `;

    const produtosResult = await clientPoolSeven.query(produtosQuery, [
      produtosIds,
    ]);
    console.log(`Encontrados ${produtosResult.rowCount} produtos`);

    // 4. Mapear os resultados combinados
    const resultadoFinal = contagensResult.rows.map((contagem) => {
      const produto = produtosResult.rows.find(
        (p) => p.id == contagem.id_produto,
      ) || {
        ds_produto: `Produto ID ${contagem.id_produto}`,
        referencia: "N/A",
      };

      return {
        ds_produto: produto.ds_produto,
        referencia: produto.referencia,
        quantidade_total: contagem.quantidade_total,
        enderecos: contagem.enderecos,
      };
    });

    res.json(resultadoFinal);
  } catch (error) {
    console.error("Erro detalhado:", {
      message: error.message,
      stack: error.stack,
      query: error.query,
    });
    res.status(500).json({
      error: "Erro ao processar a requisição",
      details: process.env.NODE_ENV === "development" ? error.message : null,
    });
  } finally {
    if (clientPool) clientPool.release();
    if (clientPoolSeven) clientPoolSeven.release();
  }
});

// estrutura completa
router.get("/estrutura-completa", async (req, res) => {
  try {
    const estrutura = await pool.query(`
      SELECT 
        r.id as rua_id,
        r.codigo as rua_codigo,
        m.id as modulo_id,
        m.codigo as modulo_codigo,
        n.id as nivel_id,
        n.codigo as nivel_codigo,
        p.id as posicao_id,
        p.codigo as posicao_codigo,
        ce.quantidade_pacotes,
        pc.descricao as produto_descricao,
        pc.referencia as produto_referencia
      FROM ruas r
      JOIN modulos m ON m.id_rua = r.id
      JOIN niveis n ON n.id_modulo = m.id
      JOIN posicoes p ON p.id_nivel = n.id
      LEFT JOIN contagem_estoque ce ON ce.id_posicao = p.id
      LEFT JOIN produtos_cache pc ON ce.id_produto = pc.id
      ORDER BY r.codigo, m.codigo, n.codigo, p.codigo
    `);

    res.json(estrutura.rows);
  } catch (error) {
    console.error("Erro ao buscar estrutura:", error);
    res.status(500).json({ error: "Erro ao carregar dados" });
  }
});

//Estrutura-tree
router.get("/contagem/por-estrutura", async (req, res) => {
  let clientPool, clientPoolSeven;

  try {
    clientPool = await pool.connect();
    clientPoolSeven = await poolSeven.connect();

    // 1. Buscar estrutura hierárquica com contagens (versão corrigida)
    const estruturaQuery = `
   SELECT 
    r.id as rua_id,
    r.codigo as rua_codigo,
    m.id as modulo_id,
    m.codigo as modulo_codigo,
    n.id as nivel_id,
    n.codigo as nivel_codigo,
    p.id as posicao_id,
    p.codigo as posicao_codigo,
    COALESCE(SUM(COALESCE(ce.quantidade_consumo::numeric, ce.quantidade_pacotes::numeric)), 0) as quantidade_total,
    (
      SELECT json_agg(
        json_build_object(
          'id_produto', ce2.id_produto,
          'ds_produto', COALESCE(pc.descricao, 'Produto ' || ce2.id_produto),
          'referencia', COALESCE(pc.referencia, 'N/A'),
          'quantidade', COALESCE(ce2.quantidade_consumo, ce2.quantidade_pacotes)
        )
      )
      FROM contagem_estoque ce2
      LEFT JOIN produtos_cache pc ON ce2.id_produto = pc.id
      WHERE ce2.id_posicao = p.id AND ce2.id_produto IS NOT NULL
    ) as itens
  FROM ruas r
  JOIN modulos m ON m.id_rua = r.id
  JOIN niveis n ON n.id_modulo = m.id
  JOIN posicoes p ON p.id_nivel = n.id
  LEFT JOIN contagem_estoque ce ON ce.id_posicao = p.id
  LEFT JOIN produtos_cache pc ON ce.id_produto = pc.id
  GROUP BY 
    r.id, r.codigo,
    m.id, m.codigo,
    n.id, n.codigo,
    p.id, p.codigo
  ORDER BY 
    r.codigo, 
    m.codigo, 
    n.codigo, 
    p.codigo
  `;
    const estruturaResult = await clientPool.query(estruturaQuery);

    // 2. Buscar produtos para o dashboard (versão simplificada)
    const contagensQuery = `
      SELECT 
        c.id_produto,
        SUM(c.quantidade_pacotes) as quantidade_total,
        (
          SELECT json_agg(
            json_build_object(
              'codigo_endereco', CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo),
              'quantidade', c2.quantidade_pacotes
            )
          )
          FROM contagem_estoque c2
          JOIN posicoes p ON c2.id_posicao = p.id
          JOIN niveis n ON p.id_nivel = n.id
          JOIN modulos m ON n.id_modulo = m.id
          JOIN ruas r ON m.id_rua = r.id
          WHERE c2.id_produto = c.id_produto
        ) as enderecos
      FROM contagem_estoque c
      WHERE c.id_produto IS NOT NULL
      GROUP BY c.id_produto
    `;

    const contagensResult = await clientPool.query(contagensQuery);

    if (contagensResult.rowCount === 0) {
      return res.json({
        estrutura: estruturaResult.rows,
        produtos: [],
      });
    }

    // 3. Buscar informações dos produtos
    const produtosIds = contagensResult.rows.map((row) => row.id_produto);
    const produtosQuery = `
      SELECT 
        produtoid AS id,
        ds_produto,
        referencia_produto AS referencia
      FROM produto
      WHERE produtoid = ANY($1::int[])
    `;

    const produtosResult = await clientPoolSeven.query(produtosQuery, [
      produtosIds,
    ]);

    // 4. Combinar os resultados
    const produtosDashboard = contagensResult.rows.map((contagem) => {
      const produto = produtosResult.rows.find(
        (p) => p.id == contagem.id_produto,
      ) || {
        ds_produto: `Produto ID ${contagem.id_produto}`,
        referencia: "N/A",
      };

      return {
        ds_produto: produto.ds_produto,
        referencia: produto.referencia,
        quantidade_total: contagem.quantidade_total,
        enderecos: contagem.enderecos || [],
      };
    });

    res.json({
      estrutura: estruturaResult.rows,
      produtos: produtosDashboard,
    });
  } catch (error) {
    console.error("Erro detalhado:", {
      message: error.message,
      stack: error.stack,
      query: error.query,
    });
    res.status(500).json({
      error: "Erro ao processar a requisição",
      details: process.env.NODE_ENV === "development" ? error.message : null,
    });
  } finally {
    if (clientPool) clientPool.release();
    if (clientPoolSeven) clientPoolSeven.release();
  }
});

// Adicione esta rota temporária para diagnóstico
router.get("/contagem/debug", async (req, res) => {
  try {
    // Teste de conexão com o banco principal
    const testPool = await pool.query("SELECT 1 AS test");

    // Teste de conexão com o AWorks
    const testPoolSeven = await poolSeven.query("SELECT 1 AS test");

    // Teste de consulta básica de contagem
    const contagemTest = await pool.query(
      "SELECT COUNT(*) FROM contagem_estoque",
    );

    // Teste de consulta básica de produtos
    const produtoTest = await poolSeven.query("SELECT COUNT(*) FROM produto");

    res.json({
      status: "OK",
      connections: {
        main_db: testPool.rows[0].test === 1,
        aworks_db: testPoolSeven.rows[0].test === 1,
      },
      record_counts: {
        contagem_estoque: contagemTest.rows[0].count,
        produto: produtoTest.rows[0].count,
      },
    });
  } catch (error) {
    console.error("Erro no diagnóstico:", error);
    res.status(500).json({
      error: "Erro no diagnóstico",
      detalhes: error.message,
      failed_query: error.query,
    });
  }
});

router.post("/detalhes-produtos", async (req, res) => {
  let clientPoolSeven;
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ error: "IDs de produtos inválidos" });
    }

    clientPoolSeven = await poolSeven.connect();
    const result = await clientPoolSeven.query(
      `SELECT 
        produtoid AS id, 
        ds_produto, 
        referencia_produto AS referencia 
       FROM produto 
       WHERE produtoid = ANY($1)`,
      [ids],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar detalhes dos produtos:", error);
    res.status(500).json({ error: "Erro ao buscar detalhes dos produtos" });
  } finally {
    if (clientPoolSeven) clientPoolSeven.release();
  }
});

router.get("/produto/:id", async (req, res) => {
  let clientPoolSeven;
  try {
    const { id } = req.params;
    clientPoolSeven = await poolSeven.connect();

    const result = await clientPoolSeven.query(
      `
      SELECT 
        produtoid AS id,
        ds_produto,
        referencia_produto AS referencia
      FROM produto
      WHERE produtoid = $1
    `,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao buscar produto:", error);
    res.status(500).json({ error: "Erro ao buscar produto" });
  } finally {
    if (clientPoolSeven) clientPoolSeven.release();
  }
});

router.get("/produtos-cache", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM produtos_cache");
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

// Rotas para Unidades
app.get("/api/unidades", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM unidades WHERE ativo = true ORDER BY descricao
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar unidades:", error);
    res.status(500).json({ error: "Erro ao buscar unidades" });
  }
});

app.post("/api/unidades", autenticarToken, async (req, res) => {
  const { codigo, descricao, tipo } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO unidades (codigo, descricao, tipo) VALUES ($1, $2, $3) RETURNING *",
      [codigo, descricao, tipo],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao criar unidade:", error);
    res.status(500).json({ error: "Erro ao criar unidade" });
  }
});

// Rotas para Conversão de Unidades
app.get("/api/unidade-conversao", autenticarToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT uc.*, 
        uo.codigo as unidade_origem_codigo, uo.descricao as unidade_origem_descricao,
        ud.codigo as unidade_destino_codigo, ud.descricao as unidade_destino_descricao
      FROM unidade_conversao uc
      JOIN unidades uo ON uc.id_unidade_origem = uo.id
      JOIN unidades ud ON uc.id_unidade_destino = ud.id
      WHERE uc.ativo = true
      ORDER BY uo.descricao, ud.descricao
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar conversões:", error);
    res.status(500).json({ error: "Erro ao buscar conversões de unidades" });
  }
});

app.post("/api/unidade-conversao", autenticarToken, async (req, res) => {
  const { id_unidade_origem, id_unidade_destino, fator_conversao, descricao } =
    req.body;

  try {
    const result = await pool.query(
      `INSERT INTO unidade_conversao 
       (id_unidade_origem, id_unidade_destino, fator_conversao, descricao) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id_unidade_origem, id_unidade_destino, fator_conversao, descricao],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao criar conversão:", error);
    res.status(500).json({ error: "Erro ao criar conversão de unidades" });
  }
});

// Atualizar produto com unidades
app.put("/api/produtos/:id/unidades", autenticarToken, async (req, res) => {
  const { id } = req.params;
  const {
    id_unidade_compra,
    id_unidade_consumo,
    fator_conversao_compra_consumo,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE produtos 
       SET id_unidade_compra = $1, id_unidade_consumo = $2, fator_conversao_compra_consumo = $3
       WHERE id = $4 RETURNING *`,
      [
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao atualizar unidades do produto:", error);
    res.status(500).json({ error: "Erro ao atualizar unidades do produto" });
  }
});

// Rota para obter inventário por mês
router.get("/inventario/:mes", async (req, res) => {
  try {
    const { mes } = req.params;
    const result = await pool.query(
      `SELECT * FROM inventario 
       WHERE mes_referencia = $1 
       ORDER BY status = 'aberto' DESC, id DESC 
       LIMIT 1`,
      [mes],
    );

    if (result.rows.length === 0) {
      return res.status(404).json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar inventário" });
  }
});

// Rota para obter contagens por inventário
router.get("/inventario/:id/contagens", async (req, res) => {
  try {
    const { id } = req.params;
    const { id_local_estoque } = req.query;

    console.log(
      `Buscando contagens para inventário ${id}, local: ${id_local_estoque || "todos"}`,
    );

    let query = `
      SELECT 
        ce.*,
        pc.descricao as produto_descricao,
        pc.referencia,
        r.codigo as rua_codigo,
        m.codigo as modulo_codigo,
        n.codigo as nivel_codigo,
        p.codigo as posicao_codigo,
        le.codigo as local_estoque_codigo,
        le.descricao as local_estoque_descricao
      FROM contagem_estoque ce
      LEFT JOIN produtos_cache pc ON ce.id_produto = pc.id
      LEFT JOIN posicoes p ON ce.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN locais_estoque le ON ce.id_local_estoque = le.id
      WHERE ce.id_inventario = $1
    `;

    const params = [id];

    if (id_local_estoque) {
      query += " AND ce.id_local_estoque = $2";
      params.push(id_local_estoque);
    }

    query += " ORDER BY ce.data_contagem DESC";

    const result = await pool.query(query, params);

    console.log(`Encontradas ${result.rows.length} contagens`);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar contagens:", error);
    res.status(500).json({ error: "Erro ao buscar contagens" });
  }
});

// Rotas para inventário
router.post("/inventario", async (req, res) => {
  try {
    const { mes_referencia, id_operador } = req.body;

    // Verifica se já existe inventário aberto para este mês
    const exists = await pool.query(
      `SELECT 1 FROM inventario 
       WHERE mes_referencia = $1 AND status = 'aberto'`,
      [mes_referencia],
    );

    if (exists.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Já existe um inventário aberto para este mês" });
    }

    const result = await pool.query(
      `INSERT INTO inventario 
       (mes_referencia, id_operador_abertura, status)
       VALUES ($1, $2, 'aberto')
       RETURNING *`,
      [mes_referencia, id_operador],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao abrir inventário" });
  }
});

router.put("/inventario/:id/fechar", async (req, res) => {
  try {
    const { id } = req.params;
    const { id_operador } = req.body;

    console.log(`Fechando inventário ${id} pelo operador ${id_operador}`);

    const result = await pool.query(
      `UPDATE inventario 
       SET status = 'fechado', 
           data_fechamento = NOW(),
           id_operador_fechamento = $1
       WHERE id = $2 AND status = 'aberto'
       RETURNING *`,
      [id_operador, id],
    );

    if (result.rows.length === 0) {
      console.log(`Inventário ${id} não encontrado ou já fechado`);
      return res
        .status(400)
        .json({ error: "Inventário não encontrado ou já fechado" });
    }

    console.log(`Inventário ${id} fechado com sucesso`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao fechar inventário:", error);
    res.status(500).json({ error: "Erro ao fechar inventário" });
  }
});

// Rota para registrar contagem
router.post("/contagem", async (req, res) => {
  console.log("Dados recebidos para contagem:", req.body);

  try {
    const {
      id_produto,
      id_posicao,
      quantidade_pacotes,
      id_operador,
      lote,
      observacao,
    } = req.body;

    // 1. Buscar inventário aberto ou criar um novo
    let inventario = await pool.query(
      `SELECT id FROM inventario WHERE status = 'aberto' 
       ORDER BY id DESC LIMIT 1`,
    );

    // Se não existir inventário aberto, criar um novo
    if (inventario.rows.length === 0) {
      const hoje = new Date();
      const mesReferencia = `${hoje.getFullYear()}-${(hoje.getMonth() + 1)
        .toString()
        .padStart(2, "0")}`;

      inventario = await pool.query(
        `INSERT INTO inventario 
         (mes_referencia, id_operador_abertura, status)
         VALUES ($1, $2, 'aberto')
         RETURNING id`,
        [mesReferencia, id_operador],
      );
    }

    const id_inventario = inventario.rows[0].id;

    // 2. Registrar a contagem com o inventário
    const result = await pool.query(
      `INSERT INTO contagem_estoque (
        id_inventario, 
        id_produto, 
        id_posicao, 
        quantidade_pacotes, 
        id_operador, 
        lote, 
        observacao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        id_inventario,
        id_produto,
        id_posicao,
        quantidade_pacotes,
        id_operador,
        lote || null,
        observacao || null,
      ],
    );

    console.log("Contagem registrada com sucesso:", result.rows[0]);
    res.status(201).json({
      message: "Contagem registrada com sucesso",
      contagem: result.rows[0],
    });
  } catch (error) {
    console.error("Erro completo no registro de contagem:", error);
    res.status(500).json({
      error: "Erro ao registrar contagem",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

router.get("/inventario/:id/relatorio", async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`Iniciando geração de relatório para inventário ${id}`);

    // 1. Verifique se o inventário existe
    const inventario = await pool.query(
      `SELECT * FROM inventario WHERE id = $1`,
      [id],
    );

    if (inventario.rows.length === 0) {
      console.error(`Inventário ${id} não encontrado`);
      return res.status(404).json({ error: "Inventário não encontrado" });
    }

    // 2. Obtenha os dados consolidados
    const consolidado = await pool.query(
      `
      SELECT 
        p.referencia,
        p.descricao as produto,
        SUM(ce.quantidade_pacotes) as quantidade_total
      FROM contagem_estoque ce
      JOIN produtos_cache p ON ce.id_produto = p.id
      WHERE ce.id_inventario = $1
      GROUP BY p.referencia, p.descricao
      ORDER BY p.referencia`,
      [id],
    );

    console.log(
      `Encontrados ${consolidado.rows.length} itens para o inventário`,
    );

    // 3. Crie o workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Inventário");

    // Estilos
    worksheet.columns = [
      { header: "Referência", key: "referencia", width: 20 },
      { header: "Produto", key: "produto", width: 30 },
      { header: "Quantidade Total", key: "quantidade", width: 15 },
    ];

    // Dados
    consolidado.rows.forEach((item) => {
      worksheet.addRow({
        referencia: item.referencia,
        produto: item.produto,
        quantidade: item.quantidade_total,
      });
    });

    // 4. Configure os headers ANTES de escrever o arquivo
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=inventario_${inventario.rows[0].mes_referencia}.xlsx`,
    );

    // 5. Envie o arquivo
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Erro ao gerar relatório:", {
      message: error.message,
      stack: error.stack,
      query: error.query,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erro ao gerar relatório",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
});

router.get("/:mes", async (req, res) => {
  try {
    const { mes } = req.params;

    console.log(`Buscando inventário para o mês: ${mes}`);

    const result = await pool.query(
      `SELECT id, mes_referencia, status, 
       data_abertura, data_fechamento,
       id_operador_abertura, id_operador_fechamento
       FROM inventario 
       WHERE mes_referencia = $1
       ORDER BY CASE WHEN status = 'aberto' THEN 0 ELSE 1 END,
       id DESC
       LIMIT 1`,
      [mes],
    );

    if (result.rows.length === 0) {
      console.log(`Nenhum inventário encontrado para ${mes}`);
      return res.status(404).json(null);
    }

    console.log(
      `Inventário encontrado: ${result.rows[0].id} - ${result.rows[0].status}`,
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro no GET /inventario:", error);
    res.status(500).json({
      error: "Erro ao buscar inventário",
      details: process.env.NODE_ENV === "development" ? error.message : null,
    });
  }
});

// Rota para criar novo inventário
router.post("/", async (req, res) => {
  try {
    const { mes_referencia, id_operador } = req.body;

    console.log(
      `Criando inventário para ${mes_referencia} pelo operador ${id_operador}`,
    );

    // Verifica se já existe inventário aberto para este mês
    const exists = await pool.query(
      `SELECT 1 FROM inventario 
       WHERE mes_referencia = $1 AND status = 'aberto'`,
      [mes_referencia],
    );

    if (exists.rows.length > 0) {
      console.log(`Já existe inventário aberto para ${mes_referencia}`);
      return res
        .status(400)
        .json({ error: "Já existe um inventário aberto para este mês" });
    }

    const result = await pool.query(
      `INSERT INTO inventario 
       (mes_referencia, id_operador_abertura, status, data_abertura)
       VALUES ($1, $2, 'aberto', NOW())
       RETURNING *`,
      [mes_referencia, id_operador],
    );

    console.log(`Inventário criado com ID: ${result.rows[0].id}`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao criar inventário:", error);
    res.status(500).json({ error: "Erro ao criar inventário" });
  }
});

// Buscar produto por EAN13
app.get("/api/estoque/produtos/por-ean/:ean", async (req, res) => {
  try {
    const { ean } = req.params;
    const result = await pool.query(
      `SELECT * FROM produtos_cache 
       WHERE ean13 = $1 LIMIT 1`,
      [ean],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar produto" });
  }
});

// Rota para buscar locais de estoque
app.get("/api/estoque/locais-estoque", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM locais_estoque WHERE ativo = true ORDER BY codigo",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar locais de estoque:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/estoque/ajustes/produtos", async (req, res) => {
  try {
    const termo = String(req.query.termo || "").trim();

    if (termo.length < 2) {
      return res.json([]);
    }

    const termoBusca = `%${termo}%`;
    const result = await pool.query(
      `SELECT
        id,
        referencia,
        descricao,
        ean13
      FROM produtos_cache
      WHERE referencia ILIKE $1
         OR descricao ILIKE $1
         OR ean13 ILIKE $1
      ORDER BY referencia NULLS LAST, descricao
      LIMIT 20`,
      [termoBusca],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar produtos para ajuste de estoque:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

async function buscarUltimoInventarioRealizado(dbClient) {
  const result = await dbClient.query(
    `SELECT id, status, mes_referencia
     FROM inventario
     ORDER BY id DESC
     LIMIT 1`,
  );

  return result.rows[0] || null;
}

function obterSubconsultaUltimaContagem(inventarioParam = "$1") {
  return `
    SELECT DISTINCT ON (
      ce.id_inventario,
      ce.id_produto,
      ce.id_posicao,
      ce.id_local_estoque
    )
      ce.*
    FROM contagem_estoque ce
    WHERE ce.id_inventario = ${inventarioParam}
    ORDER BY
      ce.id_inventario,
      ce.id_produto,
      ce.id_posicao,
      ce.id_local_estoque,
      ce.id DESC
  `;
}

app.get("/api/estoque/ajustes/produtos/:idProduto/posicoes", async (req, res) => {
  try {
    const idProduto = Number(req.params.idProduto);

    if (Number.isNaN(idProduto)) {
      return res.status(400).json({ error: "Produto inválido" });
    }

    const produtoResult = await pool.query(
      `SELECT id, referencia, descricao, ean13
       FROM produtos_cache
       WHERE id = $1`,
      [idProduto],
    );

    if (produtoResult.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    const inventarioAtual = await buscarUltimoInventarioRealizado(pool);

    if (!inventarioAtual) {
      return res.json({
        produto: produtoResult.rows[0],
        inventario: null,
        posicoes: [],
      });
    }

    const posicoesResult = await pool.query(
      `SELECT
        MAX(ce.id) AS id,
        ce.id_inventario,
        ce.id_produto,
        ce.id_posicao,
        ce.id_local_estoque,
        COALESCE(SUM(ce.quantidade_pacotes), 0)::numeric AS quantidade_pacotes,
        MAX(ce.data_contagem) AS data_contagem,
        (ARRAY_AGG(ce.observacao ORDER BY ce.id DESC))[1] AS observacao,
        r.codigo AS rua_codigo,
        r.descricao AS rua_descricao,
        m.codigo AS modulo_codigo,
        m.descricao AS modulo_descricao,
        n.codigo AS nivel_codigo,
        n.descricao AS nivel_descricao,
        p.codigo AS posicao_codigo,
        p.descricao AS posicao_descricao,
        CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) AS codigo_endereco,
        le.codigo AS local_estoque_codigo,
        le.descricao AS local_estoque_descricao
      FROM contagem_estoque ce
      JOIN posicoes p ON p.id = ce.id_posicao
      JOIN niveis n ON n.id = p.id_nivel
      JOIN modulos m ON m.id = n.id_modulo
      JOIN ruas r ON r.id = m.id_rua
      LEFT JOIN locais_estoque le ON le.id = ce.id_local_estoque
      WHERE ce.id_produto = $1
        AND ce.id_inventario = $2
      GROUP BY
        ce.id_inventario,
        ce.id_produto,
        ce.id_posicao,
        ce.id_local_estoque,
        r.codigo,
        r.descricao,
        m.codigo,
        m.descricao,
        n.codigo,
        n.descricao,
        p.codigo,
        p.descricao,
        le.codigo,
        le.descricao
      HAVING COALESCE(SUM(ce.quantidade_pacotes), 0) > 0
      ORDER BY r.codigo, m.codigo, n.codigo, p.codigo`,
      [idProduto, inventarioAtual.id],
    );

    res.json({
      produto: produtoResult.rows[0],
      inventario: inventarioAtual,
      posicoes: posicoesResult.rows,
    });
  } catch (error) {
    console.error("Erro ao listar posições para ajuste de estoque:", error);
    res.status(500).json({ error: "Erro ao listar posições do produto" });
  }
});

app.post("/api/estoque/ajustes", autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      id_produto,
      id_posicao,
      quantidade_nova,
      id_operador: idOperadorBody,
      observacao,
    } = req.body;

    const tipoOperadorToken = String(req.user?.tipo_operador || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const usuarioGestao = tipoOperadorToken === "GESTAO";
    const idOperadorToken = Number(req.user?.id);
    const idOperadorInformado = Number(idOperadorBody);
    let idOperadorEfetivo = null;

    if (
      !id_produto ||
      !id_posicao ||
      quantidade_nova == null ||
      Number.isNaN(Number(quantidade_nova))
    ) {
      return res.status(400).json({
        error: "id_produto, id_posicao e quantidade_nova são obrigatórios",
      });
    }

    const candidatosIds = [idOperadorToken, idOperadorInformado].filter(
      (id) => Number.isFinite(id) && id > 0,
    );

    let operadoresValidos = [];
    if (candidatosIds.length > 0) {
      const operadoresResult = await client.query(
        `SELECT id FROM operadores WHERE id = ANY($1::int[])`,
        [candidatosIds],
      );
      operadoresValidos = operadoresResult.rows;
    }

    const idTokenValido = operadoresValidos.some((op) => Number(op.id) === idOperadorToken);
    const idInformadoValido = operadoresValidos.some((op) => Number(op.id) === idOperadorInformado);

    if (idTokenValido) {
      idOperadorEfetivo = idOperadorToken;
    } else if (idInformadoValido) {
      idOperadorEfetivo = idOperadorInformado;
    } else if (req.user?.nome) {
      const operadorPorNomeResult = await client.query(
        `SELECT id FROM operadores WHERE nome = $1 LIMIT 1`,
        [req.user.nome],
      );
      if (operadorPorNomeResult.rows.length > 0) {
        idOperadorEfetivo = Number(operadorPorNomeResult.rows[0].id);
      }
    }

    if (!usuarioGestao && (!Number.isFinite(idOperadorEfetivo) || idOperadorEfetivo <= 0)) {
      return res.status(400).json({
        error: "Operador autenticado inválido para ajuste de estoque",
      });
    }

    if (
      Number.isFinite(idOperadorInformado) &&
      idOperadorInformado > 0 &&
      Number.isFinite(idOperadorEfetivo) &&
      idOperadorInformado !== idOperadorEfetivo
    ) {
      console.warn(
        `Ajuste de estoque com id_operador divergente. Body: ${idOperadorInformado} | Token: ${idOperadorEfetivo}`,
      );
    }

    const quantidadeNormalizada = Number(quantidade_nova);
    if (quantidadeNormalizada < 0) {
      return res.status(400).json({ error: "A quantidade não pode ser negativa" });
    }

    await client.query("BEGIN");

    let inventarioAtual = await buscarUltimoInventarioRealizado(client);

    if (!inventarioAtual) {
      if (!Number.isFinite(idOperadorEfetivo) || idOperadorEfetivo <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Não foi possível identificar operador válido para abertura automática do inventário",
        });
      }

      const hoje = new Date();
      const mesReferencia = `${hoje.getFullYear()}-${(hoje.getMonth() + 1)
        .toString()
        .padStart(2, "0")}`;

      const inventarioCriadoResult = await client.query(
        `INSERT INTO inventario (mes_referencia, id_operador_abertura, status, data_abertura)
         VALUES ($1, $2, 'aberto', NOW())
         RETURNING id, status, mes_referencia`,
        [mesReferencia, idOperadorEfetivo],
      );

      inventarioAtual = inventarioCriadoResult.rows[0];
    }

    const [produtoResult, posicaoResult] = await Promise.all([
      client.query(`SELECT id, referencia, descricao FROM produtos_cache WHERE id = $1`, [id_produto]),
      client.query(
        `SELECT
          p.id,
          p.codigo,
          p.id_local_estoque,
          r.codigo AS rua_codigo,
          r.descricao AS rua_descricao,
          m.codigo AS modulo_codigo,
          m.descricao AS modulo_descricao,
          n.codigo AS nivel_codigo,
          n.descricao AS nivel_descricao,
          p.descricao AS posicao_descricao,
          le.codigo AS local_estoque_codigo,
          le.descricao AS local_estoque_descricao
         FROM posicoes p
         JOIN niveis n ON n.id = p.id_nivel
         JOIN modulos m ON m.id = n.id_modulo
         JOIN ruas r ON r.id = m.id_rua
         LEFT JOIN locais_estoque le ON le.id = p.id_local_estoque
         WHERE p.id = $1`,
        [id_posicao],
      ),
    ]);

    if (produtoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    if (posicaoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Posição não encontrada" });
    }

    const posicao = posicaoResult.rows[0];
    const contagensExistentesResult = await client.query(
      `SELECT id, quantidade_pacotes
       FROM contagem_estoque
       WHERE id_inventario = $1
         AND id_produto = $2
         AND id_posicao = $3
         AND id_local_estoque = $4
       ORDER BY id DESC
       FOR UPDATE`,
      [inventarioAtual.id, id_produto, id_posicao, posicao.id_local_estoque || 1],
    );

    const quantidadeAnterior = contagensExistentesResult.rows.reduce(
      (total, row) => total + Number(row.quantidade_pacotes || 0),
      0,
    );

    let ajusteResult;
    if (contagensExistentesResult.rows.length > 0) {
      const idContagemPrincipal = Number(contagensExistentesResult.rows[0].id);
      const idsSecundarios = contagensExistentesResult.rows
        .slice(1)
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id) && id > 0);

      await definirContextoAuditoriaEstoque(client, {
        id_operador: idOperadorEfetivo,
        origem_modulo: "ESTOQUE_AJUSTE",
        origem_tipo: "AJUSTE_ESTOQUE",
        referencia_movimento: "AJUSTE_ESTOQUE",
        id_referencia: idContagemPrincipal,
        observacao: observacao || null,
      });

      if (idsSecundarios.length > 0) {
        await client.query(
          `UPDATE contagem_estoque
           SET quantidade_pacotes = 0,
               id_operador = COALESCE($2, id_operador),
               observacao = COALESCE($3, observacao),
               data_contagem = NOW(),
               data_hora = NOW()
           WHERE id = ANY($1::int[])`,
          [idsSecundarios, idOperadorEfetivo, observacao || null],
        );
      }

      ajusteResult = await client.query(
        `UPDATE contagem_estoque
         SET quantidade_pacotes = $1,
             id_operador = COALESCE($2, id_operador),
             observacao = $3,
             data_contagem = NOW(),
             data_hora = NOW()
         WHERE id = $4
         RETURNING *`,
        [
          quantidadeNormalizada,
          idOperadorEfetivo,
          observacao || null,
          idContagemPrincipal,
        ],
      );
    } else {
      await definirContextoAuditoriaEstoque(client, {
        id_operador: idOperadorEfetivo,
        origem_modulo: "ESTOQUE_AJUSTE",
        origem_tipo: "AJUSTE_ESTOQUE",
        referencia_movimento: "AJUSTE_ESTOQUE",
        observacao: observacao || null,
      });

      ajusteResult = await client.query(
        `INSERT INTO contagem_estoque (
          id_inventario,
          id_produto,
          id_posicao,
          quantidade_pacotes,
          id_operador,
          observacao,
          id_local_estoque,
          data_contagem,
          data_hora
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        RETURNING *`,
        [
          inventarioAtual.id,
          id_produto,
          id_posicao,
          quantidadeNormalizada,
          idOperadorEfetivo,
          observacao || null,
          posicao.id_local_estoque || 1,
        ],
      );
    }

    const diferencaAjuste = quantidadeNormalizada - quantidadeAnterior;

    if (diferencaAjuste !== 0) {
      await registrarMovimentacaoEstoque(client, {
        tipo_movimentacao: diferencaAjuste > 0 ? "ENTRADA" : "AJUSTE",
        id_produto,
        id_posicao_origem: diferencaAjuste < 0 ? id_posicao : null,
        id_posicao_destino: diferencaAjuste > 0 ? id_posicao : null,
        quantidade: Math.abs(diferencaAjuste),
        id_operador: idOperadorEfetivo,
        modulo_origem: "ESTOQUE_AJUSTE",
        referencia_movimento: "AJUSTE_ESTOQUE",
        id_referencia: ajusteResult.rows[0]?.id || null,
        observacao: observacao || null,
      });
    }

    await client.query("COMMIT");

    res.json({
      message: "Ajuste de estoque realizado com sucesso",
      inventario: inventarioAtual,
      produto: produtoResult.rows[0],
      posicao: {
        id_posicao: posicao.id,
        codigo_endereco: `${posicao.rua_codigo}-${posicao.modulo_codigo}-${posicao.nivel_codigo}-${posicao.codigo}`,
        rua_descricao: posicao.rua_descricao,
        modulo_descricao: posicao.modulo_descricao,
        nivel_descricao: posicao.nivel_descricao,
        posicao_descricao: posicao.posicao_descricao,
        local_estoque_codigo: posicao.local_estoque_codigo,
        local_estoque_descricao: posicao.local_estoque_descricao,
      },
      ajuste: ajusteResult.rows[0],
      quantidade_anterior: quantidadeAnterior,
      quantidade_nova: quantidadeNormalizada,
      diferenca: quantidadeNormalizada - quantidadeAnterior,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao ajustar estoque:", error);
    res.status(500).json({
      error: "Erro ao ajustar estoque",
      details: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    client.release();
  }
});

// ✅ NOVA ROTA: Listar produtos em uma posição (para movimentação-estoque)
app.get("/api/estoque/contagem-estoque/posicao/:idPosicao", async (req, res) => {
  try {
    const { idPosicao } = req.params;

    // Query que lista todos os produtos em uma posição com suas quantidades
      // Usa somente o último inventário global para evitar exibir saldos de contagens antigas
    // EAN14 é pré-agregado em CTE separada para evitar multiplicação do SUM
    const result = await pool.query(
        `WITH ultimo_inventario AS (
          SELECT id
          FROM inventario
          ORDER BY id DESC
          LIMIT 1
      ),
      ean14_por_produto AS (
        SELECT
          id_produto,
          ARRAY_REMOVE(ARRAY_AGG(ean14 ORDER BY ean14), NULL) AS ean14_codigos,
          MIN(ean14) AS ean14_principal
        FROM produtos_ean14
        GROUP BY id_produto
      )
      SELECT 
        MAX(ce.id) AS id,
        ce.id_produto,
        ce.id_inventario,
        pc.descricao,
        pc.referencia,
        pc.ean13,
        e14.ean14_principal AS ean14,
        e14.ean14_codigos,
        SUM(ce.quantidade_pacotes)::numeric AS quantidade_disponivel,
        ce.id_posicao,
        CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) AS codigo_endereco,
        p.id as posicao_id,
        p.codigo as posicao_codigo,
        le.codigo as local_estoque_codigo,
        MAX(ce.data_contagem) AS data_contagem,
        inv.status as status_inventario
      FROM contagem_estoque ce
      JOIN ultimo_inventario ui ON ce.id_inventario = ui.id
      JOIN posicoes p ON ce.id_posicao = p.id
      JOIN niveis n ON p.id_nivel = n.id
      JOIN modulos m ON n.id_modulo = m.id
      JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN locais_estoque le ON p.id_local_estoque = le.id
      LEFT JOIN produtos_cache pc ON ce.id_produto = pc.id
      LEFT JOIN ean14_por_produto e14 ON pc.id = e14.id_produto
      JOIN inventario inv ON ce.id_inventario = inv.id
      WHERE ce.id_posicao = $1
        AND ce.quantidade_pacotes > 0
      GROUP BY
        ce.id_produto,
        ce.id_inventario,
        pc.descricao,
        pc.referencia,
        pc.ean13,
        e14.ean14_principal,
        e14.ean14_codigos,
        ce.id_posicao,
        r.codigo,
        m.codigo,
        n.codigo,
        p.id,
        p.codigo,
        le.codigo,
        inv.status
      ORDER BY pc.referencia, pc.descricao`,
      [idPosicao]
    );

    // ✅ Retornar apenas o array de produtos para compatibilidade com o front
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao listar produtos por posição:", error);
    res.status(500).json({ 
      error: "Erro ao listar produtos da posição",
      details: error.message 
    });
  }
});

app.get("/api/estoque/movimentacoes", async (req, res) => {
  try {
    const {
      data_inicio,
      data_fim,
      id_produto,
      id_operador,
      id_posicao,
      tipo_movimentacao,
      limit = 200,
    } = req.query;

    const where = [];
    const params = [];

    if (data_inicio) {
      params.push(data_inicio);
      where.push(`m.data_movimentacao >= $${params.length}::timestamp`);
    }

    if (data_fim) {
      params.push(data_fim);
      where.push(`m.data_movimentacao <= $${params.length}::timestamp`);
    }

    if (id_produto) {
      params.push(Number(id_produto));
      where.push(`m.id_produto = $${params.length}`);
    }

    if (id_operador) {
      params.push(Number(id_operador));
      where.push(`m.id_operador = $${params.length}`);
    }

    if (id_posicao) {
      params.push(Number(id_posicao));
      where.push(`(m.id_posicao_origem = $${params.length} OR m.id_posicao_destino = $${params.length})`);
    }

    if (tipo_movimentacao) {
      params.push(String(tipo_movimentacao).toUpperCase());
      where.push(`m.tipo_movimentacao = $${params.length}`);
    }

    const limite = Math.max(1, Math.min(Number(limit) || 200, 1000));
    params.push(limite);

    const query = `
      SELECT
        m.id,
        m.tipo_movimentacao,
        m.data_movimentacao,
        m.quantidade,
        m.modulo_origem,
        m.referencia_movimento,
        m.id_referencia,
        m.observacao,
        m.id_produto,
        pc.referencia AS produto_referencia,
        pc.descricao AS produto_descricao,
        m.id_operador,
        op.nome AS operador_nome,
        m.id_posicao_origem,
        CONCAT(COALESCE(ro.codigo, 'CH'), '-', COALESCE(mo.codigo, 'CH'), '-', COALESCE(noo.codigo, 'CH'), '-', po.codigo) AS posicao_origem_codigo,
        m.id_posicao_destino,
        CONCAT(COALESCE(rd.codigo, 'CH'), '-', COALESCE(md.codigo, 'CH'), '-', COALESCE(nd.codigo, 'CH'), '-', pd.codigo) AS posicao_destino_codigo
      FROM estoque_movimentacoes m
      LEFT JOIN produtos_cache pc ON pc.id = m.id_produto
      LEFT JOIN operadores op ON op.id = m.id_operador

      LEFT JOIN posicoes po ON po.id = m.id_posicao_origem
      LEFT JOIN niveis noo ON noo.id = po.id_nivel
      LEFT JOIN modulos mo ON mo.id = noo.id_modulo
      LEFT JOIN ruas ro ON ro.id = mo.id_rua

      LEFT JOIN posicoes pd ON pd.id = m.id_posicao_destino
      LEFT JOIN niveis nd ON nd.id = pd.id_nivel
      LEFT JOIN modulos md ON md.id = nd.id_modulo
      LEFT JOIN ruas rd ON rd.id = md.id_rua

      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.data_movimentacao DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar histórico de movimentações:", error);
    res.status(500).json({
      error: "Erro ao buscar histórico de movimentações",
      details: error.message,
    });
  }
});

app.get("/api/estoque/auditoria/detalhada", async (req, res) => {
  try {
    const {
      data_inicio,
      data_fim,
      id_produto,
      produto,
      id_posicao,
      posicao,
      id_operador,
      operador,
      operacao,
      origem_modulo,
      origem_tipo,
      referencia_movimento,
      id_referencia,
      limit = 1000,
    } = req.query;

    const where = [];
    const params = [];

    if (data_inicio) {
      params.push(data_inicio);
      where.push(`a.data_evento >= $${params.length}::timestamp`);
    }

    if (data_fim) {
      params.push(data_fim);
      where.push(`a.data_evento <= $${params.length}::timestamp`);
    }

    if (id_produto) {
      params.push(Number(id_produto));
      where.push(`a.id_produto = $${params.length}`);
    } else if (produto) {
      params.push(`%${String(produto).trim()}%`);
      where.push(`(a.produto_referencia ILIKE $${params.length} OR a.produto_descricao ILIKE $${params.length})`);
    }

    if (id_posicao) {
      params.push(Number(id_posicao));
      where.push(`a.id_posicao = $${params.length}`);
    } else if (posicao) {
      params.push(`%${String(posicao).trim()}%`);
      where.push(`a.posicao_codigo ILIKE $${params.length}`);
    }

    if (id_operador) {
      params.push(Number(id_operador));
      where.push(`a.id_operador = $${params.length}`);
    } else if (operador) {
      params.push(`%${String(operador).trim()}%`);
      where.push(`a.operador_nome ILIKE $${params.length}`);
    }

    if (operacao) {
      params.push(String(operacao).toUpperCase());
      where.push(`a.operacao = $${params.length}`);
    }

    if (origem_modulo) {
      params.push(String(origem_modulo).toUpperCase());
      where.push(`UPPER(COALESCE(a.origem_modulo, '')) = $${params.length}`);
    }

    if (origem_tipo) {
      params.push(String(origem_tipo).toUpperCase());
      where.push(`UPPER(COALESCE(a.origem_tipo, '')) = $${params.length}`);
    }

    if (referencia_movimento) {
      params.push(String(referencia_movimento).toUpperCase());
      where.push(`UPPER(COALESCE(a.referencia_movimento, '')) = $${params.length}`);
    }

    if (id_referencia) {
      params.push(Number(id_referencia));
      where.push(`a.id_referencia = $${params.length}`);
    }

    const limite = Math.max(1, Math.min(Number(limit) || 1000, 5000));
    params.push(limite);

    const query = `
      SELECT
        a.id,
        a.data_evento,
        a.operacao,
        a.origem_modulo,
        a.origem_tipo,
        a.referencia_movimento,
        a.id_referencia,
        a.id_produto,
        a.produto_referencia,
        a.produto_descricao,
        a.id_posicao,
        a.posicao_codigo,
        a.quantidade_anterior,
        a.quantidade_atual,
        a.delta_quantidade,
        a.id_operador,
        a.operador_nome,
        a.observacao,
        a.txid
      FROM vw_estoque_auditoria_detalhada a
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.data_evento DESC, a.id DESC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar auditoria detalhada de estoque:", error);
    res.status(500).json({
      error: "Erro ao buscar auditoria detalhada de estoque",
      details: error.message,
    });
  }
});

app.get("/api/estoque/auditoria/resumo", async (req, res) => {
  try {
    const {
      data_inicio,
      data_fim,
      id_produto,
      produto,
      id_posicao,
      posicao,
      id_operador,
      operador,
      operacao,
      origem_modulo,
      origem_tipo,
      referencia_movimento,
      id_referencia,
    } = req.query;

    const where = [];
    const params = [];

    if (data_inicio) {
      params.push(data_inicio);
      where.push(`a.data_evento >= $${params.length}::timestamp`);
    }

    if (data_fim) {
      params.push(data_fim);
      where.push(`a.data_evento <= $${params.length}::timestamp`);
    }

    if (id_produto) {
      params.push(Number(id_produto));
      where.push(`a.id_produto = $${params.length}`);
    } else if (produto) {
      params.push(`%${String(produto).trim()}%`);
      where.push(`(a.produto_referencia ILIKE $${params.length} OR a.produto_descricao ILIKE $${params.length})`);
    }

    if (id_posicao) {
      params.push(Number(id_posicao));
      where.push(`a.id_posicao = $${params.length}`);
    } else if (posicao) {
      params.push(`%${String(posicao).trim()}%`);
      where.push(`a.posicao_codigo ILIKE $${params.length}`);
    }

    if (id_operador) {
      params.push(Number(id_operador));
      where.push(`a.id_operador = $${params.length}`);
    } else if (operador) {
      params.push(`%${String(operador).trim()}%`);
      where.push(`a.operador_nome ILIKE $${params.length}`);
    }

    if (operacao) {
      params.push(String(operacao).toUpperCase());
      where.push(`a.operacao = $${params.length}`);
    }

    if (origem_modulo) {
      params.push(String(origem_modulo).toUpperCase());
      where.push(`UPPER(COALESCE(a.origem_modulo, '')) = $${params.length}`);
    }

    if (origem_tipo) {
      params.push(String(origem_tipo).toUpperCase());
      where.push(`UPPER(COALESCE(a.origem_tipo, '')) = $${params.length}`);
    }

    if (referencia_movimento) {
      params.push(String(referencia_movimento).toUpperCase());
      where.push(`UPPER(COALESCE(a.referencia_movimento, '')) = $${params.length}`);
    }

    if (id_referencia) {
      params.push(Number(id_referencia));
      where.push(`a.id_referencia = $${params.length}`);
    }

    const query = `
      SELECT
        COUNT(*)::int AS total_eventos,
        COUNT(*) FILTER (WHERE a.operacao = 'INSERT')::int AS total_inserts,
        COUNT(*) FILTER (WHERE a.operacao = 'UPDATE')::int AS total_updates,
        COUNT(*) FILTER (WHERE a.operacao = 'DELETE')::int AS total_deletes,
        COALESCE(SUM(CASE WHEN a.delta_quantidade > 0 THEN a.delta_quantidade ELSE 0 END), 0)::numeric AS total_entradas,
        COALESCE(SUM(CASE WHEN a.delta_quantidade < 0 THEN ABS(a.delta_quantidade) ELSE 0 END), 0)::numeric AS total_saidas,
        COALESCE(SUM(a.delta_quantidade), 0)::numeric AS saldo_liquido,
        COUNT(DISTINCT a.id_produto)::int AS produtos_distintos,
        COUNT(DISTINCT a.id_posicao)::int AS posicoes_distintas,
        MAX(a.data_evento) AS ultima_movimentacao
      FROM vw_estoque_auditoria_detalhada a
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error("❌ Erro ao buscar resumo da auditoria de estoque:", error);
    res.status(500).json({
      error: "Erro ao buscar resumo da auditoria de estoque",
      details: error.message,
    });
  }
});

app.get("/api/estoque/saldo-atual", async (req, res) => {
  try {
    const { produto_ids, posicao_ids } = req.query;

    const toNumberArray = (value) => {
      if (!value) {
        return [];
      }

      return String(value)
        .split(',')
        .map((item) => Number(String(item).trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
    };

    const produtoIds = toNumberArray(produto_ids);
    const posicaoIds = toNumberArray(posicao_ids);

    const where = [
      `ce.id_inventario = COALESCE(
        (
          SELECT id FROM inventario
          WHERE status = 'fechado'
          ORDER BY id DESC
          LIMIT 1
        ),
        (
          SELECT id FROM inventario
          ORDER BY id DESC
          LIMIT 1
        )
      )`
    ];
    const params = [];

    if (produtoIds.length > 0) {
      params.push(produtoIds);
      where.push(`ce.id_produto = ANY($${params.length}::int[])`);
    }

    if (posicaoIds.length > 0) {
      params.push(posicaoIds);
      where.push(`ce.id_posicao = ANY($${params.length}::int[])`);
    }

    const query = `
      SELECT
        ce.id_produto,
        ce.id_posicao,
        SUM(ce.quantidade_pacotes)::numeric AS quantidade_atual,
        COUNT(*)::int AS itens_estoque,
        COALESCE(SUM(CASE WHEN ce.quantidade_pacotes < 0 THEN 1 ELSE 0 END), 0)::int AS linhas_negativas_contagem,
        COALESCE(MIN(ce.quantidade_pacotes), 0)::numeric AS menor_quantidade_linha,
        CONCAT(COALESCE(r.codigo, 'CH'), '-', COALESCE(m.codigo, 'CH'), '-', COALESCE(n.codigo, 'CH'), '-', p.codigo) AS codigo_endereco
      FROM contagem_estoque ce
      INNER JOIN posicoes p ON p.id = ce.id_posicao
      LEFT JOIN niveis n ON n.id = p.id_nivel
      LEFT JOIN modulos m ON m.id = n.id_modulo
      LEFT JOIN ruas r ON r.id = m.id_rua
      WHERE ${where.join(' AND ')}
      GROUP BY ce.id_produto, ce.id_posicao, r.codigo, m.codigo, n.codigo, p.codigo
      HAVING SUM(ce.quantidade_pacotes) > 0
      ORDER BY codigo_endereco
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar saldo atual de estoque:", error);
    res.status(500).json({
      error: "Erro ao buscar saldo atual de estoque",
      details: error.message,
    });
  }
});

app.get("/api/estoque/giro-operacional", async (req, res) => {
  try {
    const {
      data_inicio,
      data_fim,
      id_produto,
      produto,
      id_operador,
      operador,
      id_posicao,
      posicao,
      limit,
    } = req.query;

    const where = [];
    const params = [];
    const parseValidInt = (value) => {
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    if (data_inicio) {
      params.push(String(data_inicio));
      where.push(`g.data_movimentacao >= $${params.length}::timestamp`);
    }

    if (data_fim) {
      params.push(String(data_fim));
      where.push(`g.data_movimentacao <= $${params.length}::timestamp`);
    }

    const produtoId = parseValidInt(id_produto);
    if (produtoId) {
      params.push(produtoId);
      where.push(`g.id_produto = $${params.length}`);
    }

    const operadorId = parseValidInt(id_operador);
    if (operadorId) {
      params.push(operadorId);
      where.push(`g.id_operador = $${params.length}`);
    }

    const posicaoId = parseValidInt(id_posicao);
    if (posicaoId) {
      params.push(posicaoId);
      where.push(`(g.id_posicao_origem = $${params.length} OR g.id_posicao_destino = $${params.length})`);
    }

    if (produto && String(produto).trim() !== '') {
      params.push(`%${String(produto).trim()}%`);
      where.push(`(COALESCE(g.produto_descricao, '') ILIKE $${params.length} OR COALESCE(g.produto_referencia, '') ILIKE $${params.length})`);
    }

    if (operador && String(operador).trim() !== '') {
      params.push(`%${String(operador).trim()}%`);
      where.push(`COALESCE(g.operador_nome, '') ILIKE $${params.length}`);
    }

    if (posicao && String(posicao).trim() !== '') {
      params.push(`%${String(posicao).trim()}%`);
      where.push(`(COALESCE(g.posicao_origem_codigo, '') ILIKE $${params.length} OR COALESCE(g.posicao_destino_codigo, '') ILIKE $${params.length})`);
    }

    const limitNumero = Number(limit);
    const usarLimit = Number.isFinite(limitNumero) && limitNumero > 0;
    if (usarLimit) {
      params.push(Math.floor(limitNumero));
    }

    const query = `
      WITH entradas AS (
        SELECT
          epi.id,
          'ENTRADA'::varchar AS tipo_movimentacao,
          COALESCE(ep.data_finalizacao, ep.created_at) AS data_movimentacao,
          COALESCE(epi.quantidade_colocada, 0)::numeric AS quantidade,
          'ENTRADA_PRODUCAO'::varchar AS modulo_origem,
          'ENTRADA_PRODUCAO'::varchar AS referencia_movimento,
          ep.id::bigint AS id_referencia,
          ep.produtoid::int AS id_produto,
          pc.referencia_produto AS produto_referencia,
          pc.ds_produto AS produto_descricao,
          ep.id_operador_recebimento::int AS id_operador,
          op.nome AS operador_nome,
          ep.kardexid::varchar AS kardex_nota,
          NULL::int AS id_posicao_origem,
          epi.id_posicao::int AS id_posicao_destino,
          NULL::varchar AS posicao_origem_codigo,
          CONCAT(
            COALESCE(r.codigo, 'CH'), '-',
            COALESCE(m.codigo, 'CH'), '-',
            COALESCE(n.codigo, 'CH'), '-',
            pos.codigo
          ) AS posicao_destino_codigo,
          epi.observacoes AS observacao
        FROM entrada_producao_itens epi
        INNER JOIN entrada_producao ep ON ep.id = epi.id_entrada_producao
        LEFT JOIN produtos pc ON pc.id_cache = ep.produtoid
        LEFT JOIN operadores op ON op.id = ep.id_operador_recebimento
        LEFT JOIN posicoes pos ON pos.id = epi.id_posicao
        LEFT JOIN niveis n ON n.id = pos.id_nivel
        LEFT JOIN modulos m ON m.id = n.id_modulo
        LEFT JOIN ruas r ON r.id = m.id_rua
        WHERE ep.status = 'FINALIZADO'
          AND COALESCE(epi.quantidade_colocada, 0) > 0
          AND ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
      ),
      saidas AS (
        SELECT
          si.id,
          'SEPARACAO'::varchar AS tipo_movimentacao,
          COALESCE(si.data_separacao, si.updated_at, si.created_at) AS data_movimentacao,
          COALESCE(si.quantidade_separada, 0)::numeric AS quantidade,
          'SEPARACAO'::varchar AS modulo_origem,
          'SEPARACAO_ITEM'::varchar AS referencia_movimento,
          si.id::bigint AS id_referencia,
          COALESCE(pi.produtoid, p.id_cache)::int AS id_produto,
          COALESCE(pi.referencia, p.referencia_produto) AS produto_referencia,
          COALESCE(pi.ds_produto, p.ds_produto) AS produto_descricao,
          si.id_operador_separacao::int AS id_operador,
          o.nome AS operador_nome,
          sp.nr_nota_fiscal::varchar AS kardex_nota,
          si.id_posicao::int AS id_posicao_origem,
          NULL::int AS id_posicao_destino,
          CONCAT(
            COALESCE(r.codigo, 'CH'), '-',
            COALESCE(m.codigo, 'CH'), '-',
            COALESCE(n.codigo, 'CH'), '-',
            pos.codigo
          ) AS posicao_origem_codigo,
          NULL::varchar AS posicao_destino_codigo,
          si.observacoes AS observacao
        FROM separacao_itens si
        LEFT JOIN separacao_pedidos sp ON sp.id = si.id_separacao_pedido
        LEFT JOIN vw_pedido_itens_aworks_simples pi ON pi.pedidovendaitemid = si.pedidovendaitemid
        LEFT JOIN produtos p ON p.id_cache = pi.produtoid
        LEFT JOIN operadores o ON o.id = si.id_operador_separacao
        LEFT JOIN posicoes pos ON pos.id = si.id_posicao
        LEFT JOIN niveis n ON n.id = pos.id_nivel
        LEFT JOIN modulos m ON m.id = n.id_modulo
        LEFT JOIN ruas r ON r.id = m.id_rua
        WHERE COALESCE(si.quantidade_separada, 0) > 0
          AND si.id_posicao IS NOT NULL
      ),
      giro AS (
        SELECT * FROM entradas
        UNION ALL
        SELECT * FROM saidas
      )
      SELECT
        g.id,
        g.tipo_movimentacao,
        g.data_movimentacao,
        g.quantidade,
        g.modulo_origem,
        g.referencia_movimento,
        g.id_referencia,
        g.observacao,
        g.id_produto,
        g.produto_referencia,
        g.produto_descricao,
        g.id_operador,
        g.operador_nome,
        g.kardex_nota,
        g.id_posicao_origem,
        g.posicao_origem_codigo,
        g.id_posicao_destino,
        g.posicao_destino_codigo
      FROM giro g
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY g.data_movimentacao DESC
      ${usarLimit ? `LIMIT $${params.length}` : ''}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar giro operacional:", error);
    res.status(500).json({
      error: "Erro ao buscar giro operacional",
      details: error.message,
    });
  }
});

// Buscar posição por código
app.get("/api/estoque/posicoes/por-codigo/:codigo", async (req, res) => {
  try {
    const { codigo } = req.params;
    const result = await pool.query(
      `SELECT
        p.id,
        p.codigo,
        p.codigo_barras,
        p.descricao,
        p.id_local_estoque,
        r.codigo AS rua_codigo,
        r.descricao AS rua_descricao,
        m.codigo AS modulo_codigo,
        m.descricao AS modulo_descricao,
        n.codigo AS nivel_codigo,
        n.descricao AS nivel_descricao,
        le.codigo AS local_estoque_codigo,
        le.descricao AS local_estoque_descricao
       FROM posicoes p
       JOIN niveis n ON n.id = p.id_nivel
       JOIN modulos m ON m.id = n.id_modulo
       JOIN ruas r ON r.id = m.id_rua
       LEFT JOIN locais_estoque le ON le.id = p.id_local_estoque
       WHERE p.codigo_barras = $1 OR p.codigo = $1`,
      [codigo],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Posição não encontrada" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erro ao buscar posição" });
  }
});

// Rota de transferência atualizada
app.post("/api/estoque/transferencias", async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      ean13,
      codigo_posicao_origem,
      codigo_posicao_destino,
      quantidade,
      id_operador,
    } = req.body;

    const quantidadeNum = Number(quantidade);
    if (!ean13 || !codigo_posicao_origem || !codigo_posicao_destino || !id_operador || !Number.isFinite(quantidadeNum) || quantidadeNum <= 0) {
      return res.status(400).json({ error: "Dados inválidos para transferência" });
    }

    const resolverPosicaoPorCodigo = async (codigo, tipo) => {
      const codigoNormalizado = String(codigo || "").trim();

      const porCodigoBarras = await client.query(
        `SELECT id, id_local_estoque, codigo, codigo_barras
         FROM posicoes
         WHERE codigo_barras = $1
         ORDER BY id DESC
         LIMIT 2`,
        [codigoNormalizado],
      );

      if (porCodigoBarras.rows.length > 1) {
        const error = new Error(`Código de barras de ${tipo} ambíguo`);
        error.status = 409;
        throw error;
      }

      if (porCodigoBarras.rows.length === 1) {
        return porCodigoBarras.rows[0];
      }

      const porCodigo = await client.query(
        `SELECT id, id_local_estoque, codigo, codigo_barras
         FROM posicoes
         WHERE codigo = $1
         ORDER BY id DESC
         LIMIT 3`,
        [codigoNormalizado],
      );

      if (porCodigo.rows.length === 0) {
        const error = new Error(`Posição de ${tipo} não encontrada`);
        error.status = 400;
        throw error;
      }

      if (porCodigo.rows.length > 1) {
        const error = new Error(`Código de ${tipo} ambíguo. Use o código de barras da posição.`);
        error.status = 409;
        throw error;
      }

      return porCodigo.rows[0];
    };

    await client.query("BEGIN");

    await definirContextoAuditoriaEstoque(client, {
      id_operador,
      origem_modulo: "MOVIMENTACAO_ESTOQUE",
      origem_tipo: "TRANSFERENCIA",
      referencia_movimento: "TRANSFERENCIA",
      observacao: `Transferência de ${codigo_posicao_origem} para ${codigo_posicao_destino}`,
    });

    // 1. Verificar produto (aceita EAN13, EAN14 e referência)
    const produto = await client.query(
      `SELECT pc.id
       FROM produtos_cache pc
       LEFT JOIN produtos_ean14 pe ON pe.id_produto = pc.id
       WHERE pc.ean13 = $1
          OR pc.referencia = $1
          OR pe.ean14 = $1
       ORDER BY CASE WHEN pc.ean13 = $1 THEN 0 WHEN pe.ean14 = $1 THEN 1 ELSE 2 END, pc.id
       LIMIT 1`,
      [String(ean13).trim()],
    );

    if (produto.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Produto não encontrado" });
    }

    // 2. Resolver posições de forma determinística (evita LIMIT 1 ambíguo)
    const posicaoOrigem = await resolverPosicaoPorCodigo(codigo_posicao_origem, "origem");
    const posicaoDestino = await resolverPosicaoPorCodigo(codigo_posicao_destino, "destino");

    if (Number(posicaoOrigem.id) === Number(posicaoDestino.id)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Origem e destino não podem ser a mesma posição" });
    }

    // 3. Selecionar inventário a partir do estoque real da origem
    const inventarioOrigem = await client.query(
      `SELECT ce.id_inventario
       FROM contagem_estoque ce
       JOIN inventario inv ON inv.id = ce.id_inventario
       WHERE ce.id_posicao = $1
         AND ce.id_produto = $2
         AND ce.quantidade_pacotes > 0
       ORDER BY
         CASE inv.status WHEN 'fechado' THEN 0 ELSE 1 END,
         ce.id_inventario DESC
       LIMIT 1`,
      [posicaoOrigem.id, produto.rows[0].id],
    );

    if (inventarioOrigem.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Produto não encontrado na posição de origem para nenhum inventário ativo",
      });
    }

    const id_inventario = Number(inventarioOrigem.rows[0].id_inventario);
    console.log(`📋 Transferência usando inventário da origem: ${id_inventario}`);

    // 4. Saldo no destino antes do crédito (para validação de consistência)
    const saldoDestinoAntes = await client.query(
      `SELECT COALESCE(SUM(quantidade_pacotes), 0)::numeric AS saldo
       FROM contagem_estoque
       WHERE id_posicao = $1
         AND id_produto = $2
         AND id_inventario = $3`,
      [posicaoDestino.id, produto.rows[0].id, id_inventario],
    );
    const saldoAntes = Number(saldoDestinoAntes.rows?.[0]?.saldo || 0);

    // 5. Baixar da origem distribuindo entre múltiplas linhas positivas (sem estoque negativo)
    const baixaOrigem = await client.query(
      `WITH linhas_bloqueadas AS (
         SELECT
           ce.id,
           ce.quantidade_pacotes,
           COALESCE(ce.data_contagem, ce.data_hora) AS ordem_data
         FROM contagem_estoque ce
         WHERE ce.id_posicao = $2
           AND ce.id_produto = $3
           AND ce.id_inventario = $4
           AND ce.quantidade_pacotes > 0
         ORDER BY COALESCE(ce.data_contagem, ce.data_hora), ce.id
         FOR UPDATE
       ),
       linhas AS (
         SELECT
           lb.id,
           lb.quantidade_pacotes,
           COALESCE(
             SUM(lb.quantidade_pacotes) OVER (
               ORDER BY lb.ordem_data, lb.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ),
             0
           ) AS acumulado_anterior
         FROM linhas_bloqueadas lb
       ),
       consumo AS (
         SELECT
           l.id,
           LEAST(
             l.quantidade_pacotes,
             GREATEST(0, $1::numeric - l.acumulado_anterior)
           ) AS qtd_baixar
         FROM linhas l
         WHERE l.acumulado_anterior < $1::numeric
       ),
       atualizados AS (
         UPDATE contagem_estoque ce
         SET quantidade_pacotes = GREATEST(0, ce.quantidade_pacotes - c.qtd_baixar),
             data_hora = NOW(),
             data_contagem = NOW(),
             id_operador = $5
         FROM consumo c
         WHERE ce.id = c.id
           AND c.qtd_baixar > 0
         RETURNING ce.id, c.qtd_baixar
       )
       SELECT
         COALESCE(SUM(qtd_baixar), 0)::numeric AS total_baixado,
         COALESCE((ARRAY_AGG(id ORDER BY id))[1], 0)::int AS id_contagem_origem
       FROM atualizados`,
      [quantidadeNum, posicaoOrigem.id, produto.rows[0].id, id_inventario, id_operador],
    );

    const totalBaixado = Number(baixaOrigem.rows?.[0]?.total_baixado || 0);
    const idContagemOrigem = Number(baixaOrigem.rows?.[0]?.id_contagem_origem || 0);

    if (totalBaixado < quantidadeNum || !idContagemOrigem) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Produto não encontrado na posição de origem ou quantidade insuficiente",
      });
    }

    // 6. Criar ou atualizar contagem no destino
    const linhaDestino = await client.query(
      `SELECT id
       FROM contagem_estoque
       WHERE id_posicao = $1
         AND id_produto = $2
         AND id_inventario = $3
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [posicaoDestino.id, produto.rows[0].id, id_inventario],
    );

    let contagemDestino;

    if (linhaDestino.rows.length === 0) {
      // Inserir novo registro
      const insertDestinoResult = await client.query(
        `INSERT INTO contagem_estoque (
          id_inventario, id_produto, id_posicao, 
          quantidade_pacotes, id_operador, id_local_estoque, data_contagem, data_hora
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING *`,
        [
          id_inventario,
          produto.rows[0].id,
          posicaoDestino.id,
          quantidadeNum,
          id_operador,
          posicaoDestino.id_local_estoque || posicaoOrigem.id_local_estoque || 1,
        ],
      );
      contagemDestino = insertDestinoResult.rows[0];
    } else {
      const atualizarDestinoResult = await client.query(
        `UPDATE contagem_estoque
         SET quantidade_pacotes = quantidade_pacotes + $1,
             data_hora = NOW(),
             data_contagem = NOW(),
             id_operador = $2
         WHERE id = $3
         RETURNING *`,
        [quantidadeNum, id_operador, linhaDestino.rows[0].id],
      );
      contagemDestino = atualizarDestinoResult.rows[0];
    }

    const saldoDestinoDepois = await client.query(
      `SELECT COALESCE(SUM(quantidade_pacotes), 0)::numeric AS saldo
       FROM contagem_estoque
       WHERE id_posicao = $1
         AND id_produto = $2
         AND id_inventario = $3`,
      [posicaoDestino.id, produto.rows[0].id, id_inventario],
    );
    const saldoDepois = Number(saldoDestinoDepois.rows?.[0]?.saldo || 0);
    const acrescimo = saldoDepois - saldoAntes;

    if (Math.abs(acrescimo - quantidadeNum) > 0.000001) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Inconsistência detectada ao creditar destino. Transferência cancelada.",
        details: {
          saldo_antes: saldoAntes,
          saldo_depois: saldoDepois,
          acrescimo,
          esperado: quantidadeNum,
        },
      });
    }

    // 7. Registrar transferência
    await client.query(
      `INSERT INTO transferencias (
        id_contagem_origem, id_contagem_destino,
        quantidade, id_operador, ean13
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        idContagemOrigem,
        contagemDestino.id,
        quantidadeNum,
        id_operador,
        ean13,
      ],
    );

    await registrarMovimentacaoEstoque(client, {
      tipo_movimentacao: "TRANSFERENCIA",
      id_produto: produto.rows[0].id,
      id_posicao_origem: posicaoOrigem.id,
      id_posicao_destino: posicaoDestino.id,
      quantidade: quantidadeNum,
      id_operador,
      modulo_origem: "MOVIMENTACAO_ESTOQUE",
      referencia_movimento: "TRANSFERENCIA",
      id_referencia: contagemDestino.id,
      observacao: `Transferência de ${codigo_posicao_origem} para ${codigo_posicao_destino}`,
    });

    await client.query("COMMIT");
    res.status(201).json({
      message: "Transferência realizada com sucesso",
      produto: produto.rows[0],
      id_inventario,
      origem: { id: idContagemOrigem, quantidade_baixada: quantidadeNum },
      destino: contagemDestino,
      saldo_destino_antes: saldoAntes,
      saldo_destino_depois: saldoDepois,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro na transferência:", error);
    if (error?.status) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({
      error: "Erro ao processar transferência",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    client.release();
  }
});

app.post("/api/estoque/movimentacoes", async (req, res) => {
  try {
    const {
      tipo,
      produto_id,
      posicao_id,
      quantidade,
      documento,
      operador_id,
      observacao,
    } = req.body;

    // Validar dados
    if (
      !["entrada", "saida"].includes(tipo) ||
      !produto_id ||
      !posicao_id ||
      !quantidade ||
      !operador_id
    ) {
      return res.status(400).json({ error: "Dados inválidos ou incompletos" });
    }

    // Registrar movimentação
    const result = await pool.query(
      `INSERT INTO movimentacoes_estoque (
        tipo, produto_id, posicao_id, quantidade, 
        documento, operador_id, observacao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        tipo,
        produto_id,
        posicao_id,
        quantidade,
        documento || null,
        operador_id,
        observacao || null,
      ],
    );

    // Atualizar estoque
    if (tipo === "entrada") {
      await pool.query(
        `INSERT INTO contagem_estoque (produto_id, posicao_id, quantidade)
         VALUES ($1, $2, $3)
         ON CONFLICT (produto_id, posicao_id) 
         DO UPDATE SET quantidade = contagem_estoque.quantidade + $3`,
        [produto_id, posicao_id, quantidade],
      );
    } else {
      await pool.query(
        `UPDATE contagem_estoque 
         SET quantidade = quantidade - $1
         WHERE produto_id = $2 AND posicao_id = $3
         AND quantidade >= $1`,
        [quantidade, produto_id, posicao_id],
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao registrar movimentação:", error);
    res.status(500).json({ error: "Erro ao registrar movimentação" });
  }
});

// Rota para imprimir código de barras de posição
router.post("/impressao/codigo-posicao", async (req, res) => {
  try {
    const { codigo, descricao, codigo_barras } = req.body;

    const printResult = await enviarParaImpressora({
      type: "POSITION",
      code: codigo,
      barcode: codigo_barras,
      description: descrica,
    });

    res.status(200).json({ success: true, printResult });
  } catch (error) {
    console.error("Erro ao imprimir código:", error);
    res.status(500).json({ error: "Erro ao imprimir código de barras" });
  }
});

// Rota para imprimir múltiplos códigos
router.post("/impressao/multiplos-codigos", async (req, res) => {
  try {
    const { posicoes } = req.body;

    // Implemente a lógica de impressão em lote aqui
    const printResults = [];
    for (const pos of posicoes) {
      const result = await enviarParaImpressora({
        type: "POSITION",
        code: pos.codigo,
        barcode: pos.codigo_barras,
        description: pos.descricao,
      });
      printResults.push(result);
    }

    res.status(200).json({ success: true, printResults });
  } catch (error) {
    console.error("Erro ao imprimir códigos:", error);
    res.status(500).json({ error: "Erro ao imprimir códigos de barras" });
  }
});

async function enviarParaImpressora(comandos) {
  try {
    const response = await axios.post(`${printServiceUrl}/print`, {
      commands: comandos,
      printer: "argox",
    });
    return response.data;
  } catch (error) {
    console.error("Erro ao enviar para print-service:", error);
    throw error;
  }
}

// Rota para listar todas as posições com hierarquia
app.get("/api/estoque/posicoes/todas", async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id,
        p.codigo as posicao,
        p.descricao,
        p.codigo_barras,
        n.codigo as nivel,
        m.codigo as modulo,
        r.codigo as rua
      FROM posicoes p
      JOIN niveis n ON p.id_nivel = n.id
      JOIN modulos m ON n.id_modulo = m.id
      JOIN ruas r ON m.id_rua = r.id
      ORDER BY r.codigo, m.codigo, n.codigo, p.codigo
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar posições:", error);
    res.status(500).json({ error: "Erro ao buscar posições" });
  }
});

// Rota para gerar múltiplos cartões A6 em folha A4 HORIZONTAL com filtro por local
app.post("/api/estoque/gerar-pdf-codigos", async (req, res) => {
  let doc;
  try {
    const { posicoes, id_local_estoque } = req.body;

    if (!posicoes || !Array.isArray(posicoes)) {
      return res.status(400).json({ error: "Dados de posições inválidos" });
    }

    // 🔹 FILTRAR POSIÇÕES DE CHÃO (não imprimir)
    // Posições de chão têm código começando com "CH" ou descrição contendo "CH"
    const posicoesRack = posicoes.filter(pos => {
      const codigo = (pos.codigo || '').toUpperCase();
      const descricao = (pos.descricao || '').toUpperCase();
      // Exclui se começar com CH ou contiver CH seguido de número
      return !codigo.startsWith('CH') && !descricao.match(/^CH\d/);
    });

    console.log(
      `Gerando PDF para ${posicoesRack.length} posições de rack (${posicoes.length - posicoesRack.length} posições de chão filtradas), local: ${id_local_estoque}`,
    );

    if (posicoesRack.length === 0) {
      return res.status(400).json({ error: "Nenhuma posição de rack para imprimir" });
    }

    // PDF em A4 RETRATO (vertical) para expedição
    const isExpedicao = id_local_estoque === 1;
    
    doc = new PDFDocument({
      size: "A4",
      layout: isExpedicao ? "portrait" : "landscape",
      margin: 15,
      bufferPages: true,
    });

    // Configura headers
    res.setHeader("Content-Type", "application/pdf");

    // Nome do arquivo baseado no local de estoque
    let filename = "placas_posicoes_a4.pdf";
    if (id_local_estoque === 2) {
      filename = "placas_almoxarifado_a4_horizontal.pdf";
    } else if (id_local_estoque === 1) {
      filename = "placas_expedicao_7x12cm.pdf";
    }

    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    doc.pipe(res);

    // 🔹 DIMENSÕES PARA EXPEDIÇÃO: 7cm x 12cm
    let cardWidth, cardHeight, cols, rows;
    
    if (isExpedicao) {
      // Etiquetas de 7cm x 12cm em pontos (1cm ≈ 28.35 pontos)
      cardWidth = 198; // 7cm ≈ 198 pontos
      cardHeight = 340; // 12cm ≈ 340 pontos
      cols = 3; // 3 etiquetas por linha (21cm / 7cm)
      rows = 2; // 2 etiquetas por coluna (29.7cm / 12cm ≈ 2.5)
      console.log(`🔧 Etiquetas 7x12cm para EXPEDIÇÃO - Grade 3x2`);
    } else {
      // Configuração antiga para almoxarifado
      cardWidth = 420;
      cardHeight = 170;
      cols = 2;
      rows = 2;
    }

    // Dimensões da página A4
    const a4Width = doc.page.width;
    const a4Height = doc.page.height;

    const horizontalSpacing = (a4Width - cardWidth * cols) / (cols + 1);
    const verticalSpacing = (a4Height - cardHeight * rows) / (rows + 1);


    let currentCol = 0;
    let currentRow = 0;

    // Função para gerar código de barras
    const generateBarcode = async (text) => {
      try {
        return await bwipjs.toBuffer({
          bcid: "code128",
          text: text,
          scale: 3,
          height: 16,
          includetext: false,
        });
      } catch (err) {
        console.error("Erro ao gerar código de barras:", err);
        return null;
      }
    };

    // Tenta carregar o logo
    let logoBuffer = null;
    try {
      const fs = require("fs");
      const path = require("path");

      const backendDir = __dirname;
      const logoPath = path.join(
        backendDir,
        "../../src/assets/images/logos/simples.png",
      );

      console.log("Tentando carregar logo de:", logoPath);

      if (fs.existsSync(logoPath)) {
        logoBuffer = fs.readFileSync(logoPath);
        console.log("✅ Logo carregado com sucesso!");
      } else {
        console.warn("❌ Logo não encontrado");
      }
    } catch (logoError) {
      console.warn("Erro ao carregar logo:", logoError);
    }

    // Processa cada posição de rack
    for (const [index, pos] of posicoesRack.entries()) {
      // Calcula posição do cartão na folha A4
      const x = horizontalSpacing + currentCol * (cardWidth + horizontalSpacing);
      const y = verticalSpacing + currentRow * (cardHeight + verticalSpacing);

      // Gera código de barras
      const barcodeText = pos.codigo_barras || pos.posicao;
      const barcodeImage = await generateBarcode(barcodeText);

      // Desenha o container (borda para facilitar recorte)
      doc.rect(x, y, cardWidth, cardHeight).stroke();

      if (isExpedicao) {
        // 🔹 LAYOUT PARA EXPEDIÇÃO (7cm x 12cm)
        
        // 1️⃣ LOGO NO TOPO (centralizado)
        if (logoBuffer) {
          try {
            const logoWidth = 28; // 1cm ≈ 28 pontos
            const logoHeight = 42; // 1.5cm ≈ 42 pontos
            const logoX = x + (cardWidth - logoWidth) / 2; // Centralizado
            const logoY = y + 10;
            
            doc.image(logoBuffer, logoX, logoY, {
              width: logoWidth,
              height: logoHeight,
            });
          } catch (imageError) {
            console.warn("Erro ao adicionar logo:", imageError);
          }
        }

        // 2️⃣ INFORMAÇÕES PRINCIPAIS (RUA, MÓDULO, NÍVEL) - Fontes MAIORES
        const infoStartY = y + 65; // Após o logo
        const labelX = x + 15;
        const valueX = x + 70;
        const lineSpacing = 24; // Espaçamento entre linhas

        doc
          .fontSize(14) // Fonte MAIOR para labels
          .font("Helvetica-Bold")
          .text("RUA:", labelX, infoStartY)
          .text("MÓD:", labelX, infoStartY + lineSpacing)
          .text("NÍVEL:", labelX, infoStartY + lineSpacing * 2);

        doc
          .fontSize(14) // Fonte MAIOR para valores
          .font("Helvetica")
          .text(pos.rua || "-", valueX, infoStartY)
          .text(pos.modulo || "-", valueX, infoStartY + lineSpacing)
          .text(pos.nivel || "-", valueX, infoStartY + lineSpacing * 2);

        // 3️⃣ CÓDIGO DA POSIÇÃO (Fonte MENOR que antes - era 32, agora 20)
        const posicaoY = infoStartY + lineSpacing * 3 + 10;
        doc
          .fontSize(20) // Reduzido de 32 para 20
          .font("Helvetica-Bold")
          .text(pos.posicao || pos.codigo || "-", x + 10, posicaoY, {
            width: cardWidth - 20,
            align: "center",
          });

        // 4️⃣ CÓDIGO DE BARRAS (mantém tamanho)
        const barcodeY = y + cardHeight - 120;
        
        if (barcodeImage) {
          const barcodeWidth = 140;
          const barcodeHeight = 60;
          const barcodeX = x + (cardWidth - barcodeWidth) / 2; // Centralizado
          
          doc.image(barcodeImage, barcodeX, barcodeY, {
            width: barcodeWidth,
            height: barcodeHeight,
          });

          // Texto abaixo do código de barras
          doc
            .fontSize(10)
            .font("Helvetica")
            .text(barcodeText, x + 10, barcodeY + barcodeHeight + 5, {
              width: cardWidth - 20,
              align: "center",
            });
        }
      } else {
        // 🔹 LAYOUT ANTIGO PARA ALMOXARIFADO (mantém como estava)
        const baseY = y + 10;
        const lineHeight = 14;

        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .text("RUA:", x + 15, baseY)
          .text("MOD:", x + 15, baseY + lineHeight)
          .text("NÍVEL:", x + 15, baseY + lineHeight * 2);

        doc
          .font("Helvetica")
          .text(pos.rua, x + 50, baseY)
          .text(pos.modulo, x + 50, baseY + lineHeight)
          .text(pos.nivel, x + 50, baseY + lineHeight * 2);

        const posicaoY = baseY + 3;
        doc
          .fontSize(24)
          .font("Helvetica-Bold")
          .text(pos.posicao, x + 150, posicaoY, {
            width: 120,
            align: "center",
          });

        const linhaY = y + 50;
        doc
          .moveTo(x + 10, linhaY)
          .lineTo(x + cardWidth - 10, linhaY)
          .stroke();

        const barcodeY = y + 60;
        const barcodeHeight = 35;

        if (barcodeImage) {
          doc.image(barcodeImage, x + 150, barcodeY, {
            width: 150,
            height: barcodeHeight,
          });

          const textoBarcodeY = y + 100;
          doc
            .fontSize(10)
            .font("Helvetica")
            .text(barcodeText, x + 150, textoBarcodeY, {
              width: 150,
              align: "center",
            });
        }

        if (logoBuffer) {
          try {
            const areaInferiorY = y + cardHeight - 70;
            const logoWidth = 45;
            const logoHeight = 55;

            doc.image(logoBuffer, x + 20, areaInferiorY, {
              width: logoWidth,
              height: logoHeight,
            });
          } catch (imageError) {
            console.warn("Erro ao adicionar logo:", imageError);
          }
        }
      }


      // Atualiza posição na grade
      currentCol++;
      if (currentCol >= cols) {
        currentCol = 0;
        currentRow++;

        // Nova página se necessário
        if (currentRow >= rows) {
          doc.addPage({
            size: "A4",
            layout: isExpedicao ? "portrait" : "landscape",
          });
          currentRow = 0;
          currentCol = 0;
        }
      }
    }

    console.log(`✅ PDF gerado com sucesso - ${posicoesRack.length} posições de rack`);
    doc.end();
  } catch (error) {
    console.error("Erro fatal ao gerar PDF:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao gerar PDF" });
    }
    if (doc) {
      doc.end();
    }
  }
});

// ========== ✨ NOVA ROTA: IMPRIMIR APENAS CHECKOUT (Rua 1, Zona Chão1) ==========
app.post("/api/estoque/gerar-pdf-checkout", async (req, res) => {
  let doc;
  try {
    const { id_local_estoque } = req.body;

    // 🔹 CRIAR POSIÇÃO CHECKOUT HARDCODADA
    const checkoutPos = {
      rua: "1",
      modulo: "-",
      nivel: "Chão",
      posicao: "CHECKOUT",
      codigo_barras: "CHECKOUT",
      descricao: "Posição de Checkout"
    };

    console.log(`🛒 Gerando PDF para CHECKOUT - local: ${id_local_estoque}`);

    // PDF em A4 RETRATO para expedição
    const isExpedicao = id_local_estoque === 1 || id_local_estoque === undefined;
    
    doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 15,
      bufferPages: true,
    });

    // Configura headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=placa_checkout.pdf");
    doc.pipe(res);

    // 🔹 DIMENSÕES PARA EXPEDIÇÃO: 7cm x 12cm
    const cardWidth = 198;  // 7cm ≈ 198 pontos
    const cardHeight = 340; // 12cm ≈ 340 pontos
    const cols = 3;
    const rows = 2;

    const a4Width = doc.page.width;
    const a4Height = doc.page.height;

    const horizontalSpacing = (a4Width - cardWidth * cols) / (cols + 1);
    const verticalSpacing = (a4Height - cardHeight * rows) / (rows + 1);

    // Função para gerar código de barras
    const generateBarcode = async (text) => {
      try {
        return await bwipjs.toBuffer({
          bcid: "code128",
          text: text,
          scale: 3,
          height: 16,
          includetext: false,
        });
      } catch (err) {
        console.error("Erro ao gerar código de barras:", err);
        return null;
      }
    };

    // Tenta carregar o logo
    let logoBuffer = null;
    try {
      const fs = require("fs");
      const path = require("path");
      const backendDir = __dirname;
      const logoPath = path.join(backendDir, "../../src/assets/images/logos/simples.png");

      if (fs.existsSync(logoPath)) {
        logoBuffer = fs.readFileSync(logoPath);
        console.log("✅ Logo carregado com sucesso!");
      } else {
        console.warn("❌ Logo não encontrado");
      }
    } catch (logoError) {
      console.warn("Erro ao carregar logo:", logoError);
    }

    // Posição na grade: primeira posição (0,0)
    const x = horizontalSpacing;
    const y = verticalSpacing;

    // Gera código de barras
    const barcodeText = checkoutPos.codigo_barras;
    const barcodeImage = await generateBarcode(barcodeText);

    // Desenha o container (borda)
    doc.rect(x, y, cardWidth, cardHeight).stroke();

    // 🔹 LAYOUT PARA CHECKOUT
    
    // 1️⃣ LOGO NO TOPO (centralizado)
    if (logoBuffer) {
      try {
        const logoWidth = 28;
        const logoHeight = 42;
        const logoX = x + (cardWidth - logoWidth) / 2;
        const logoY = y + 10;
        
        doc.image(logoBuffer, logoX, logoY, {
          width: logoWidth,
          height: logoHeight,
        });
      } catch (imageError) {
        console.warn("Erro ao adicionar logo:", imageError);
      }
    }

    // 2️⃣ INFORMAÇÕES PRINCIPAIS (RUA, NÍVEL) - Fontes MAIORES
    const infoStartY = y + 65;
    const labelX = x + 15;
    const valueX = x + 70;
    const lineSpacing = 24;

    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("RUA:", labelX, infoStartY)
      .text("ZONA:", labelX, infoStartY + lineSpacing);

    doc
      .fontSize(14)
      .font("Helvetica")
      .text(checkoutPos.rua || "-", valueX, infoStartY)
      .text(checkoutPos.nivel || "-", valueX, infoStartY + lineSpacing);

    // 3️⃣ CÓDIGO DA POSIÇÃO (CHECKOUT - Destaque maior)
    const posicaoY = infoStartY + lineSpacing * 2 + 10;
    doc
      .fontSize(28)
      .font("Helvetica-Bold")
      .fillColor("#dc2626") // Vermelho para destaque
      .text(checkoutPos.posicao, x + 10, posicaoY, {
        width: cardWidth - 20,
        align: "center",
      })
      .fillColor("black"); // Volta para preto

    // 4️⃣ CÓDIGO DE BARRAS
    const barcodeY = y + cardHeight - 120;
    
    if (barcodeImage) {
      const barcodeWidth = 140;
      const barcodeHeight = 60;
      const barcodeX = x + (cardWidth - barcodeWidth) / 2;
      
      doc.image(barcodeImage, barcodeX, barcodeY, {
        width: barcodeWidth,
        height: barcodeHeight,
      });

      // Texto abaixo do código de barras
      doc
        .fontSize(10)
        .font("Helvetica")
        .text(barcodeText, x + 10, barcodeY + barcodeHeight + 5, {
          width: cardWidth - 20,
          align: "center",
        });
    }

    console.log(`✅ PDF CHECKOUT gerado com sucesso!`);
    doc.end();
  } catch (error) {
    console.error("Erro fatal ao gerar PDF CHECKOUT:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao gerar PDF CHECKOUT" });
    }
    if (doc) {
      doc.end();
    }
  }
});

// ========== 🏷️ NOVA ROTA: IMPRIMIR QUALQUER POSIÇÃO (Genérica) ==========
app.get("/api/estoque/gerar-pdf-posicao/:posicao_id", async (req, res) => {
  let doc;
  try {
    const { posicao_id } = req.params;
    console.log(`🖨️ [PDF] Iniciando geração para posição ID: ${posicao_id}`);

    // 🔹 BUSCAR POSIÇÃO DO BANCO DE DADOS
    const queryPosicao = `
      SELECT 
        p.id,
        p.codigo as posicao_codigo,
        r.codigo as rua_codigo,
        m.codigo as modulo_codigo,
        n.codigo as nivel_codigo,
        p.codigo_barras,
        r.id as rua_id,
        m.id as modulo_id,
        n.id as nivel_id
      FROM posicoes p
      JOIN niveis n ON n.id = p.id_nivel
      JOIN modulos m ON m.id = n.id_modulo
      JOIN ruas r ON r.id = m.id_rua
      WHERE p.id = $1
    `;

    const resultPosicao = await pool.query(queryPosicao, [posicao_id]);
    
    if (resultPosicao.rows.length === 0) {
      console.warn(`⚠️ Posição ${posicao_id} não encontrada`);
      return res.status(404).json({ error: "Posição não encontrada" });
    }

    const posicao = resultPosicao.rows[0];
    console.log(`✅ Posição encontrada: ${posicao.posicao_codigo}`);
    
    // 🛒 Se for a posição 845 (CH1-Z1-P1), renomeia para CHECKOUT
    if (posicao.id === 845) {
      console.log(`🛒 Renomeando posição 845 para CHECKOUT`);
      posicao.posicao_codigo = 'CHECKOUT';
    }

    console.log(`📍 Gerando PDF para posição: ${posicao.posicao_codigo} (Rua ${posicao.rua_codigo})`);

    // PDF em A4 RETRATO
    doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margin: 15,
      bufferPages: true,
    });

    // Configura headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=placa_${posicao.posicao_codigo}.pdf`);
    doc.pipe(res);

    console.log(`📄 Document piped para response`);

    // 🔹 DIMENSÕES: 7cm x 12cm (padrão expedição)
    const cardWidth = 198;
    const cardHeight = 340;
    const cols = 3;
    const rows = 2;

    const a4Width = doc.page.width;
    const a4Height = doc.page.height;

    const horizontalSpacing = (a4Width - cardWidth * cols) / (cols + 1);
    const verticalSpacing = (a4Height - cardHeight * rows) / (rows + 1);

    // Função para gerar código de barras
    const generateBarcode = async (text) => {
      try {
        console.log(`📊 Gerando barcode para: ${text}`);
        const barcode = await bwipjs.toBuffer({
          bcid: "code128",
          text: text || "SEM-BARRAS",
          scale: 3,
          height: 16,
          includetext: false,
        });
        console.log(`✅ Barcode gerado com sucesso`);
        return barcode;
      } catch (err) {
        console.error("❌ Erro ao gerar código de barras:", err);
        return null;
      }
    };

    // Tenta carregar o logo
    let logoBuffer = null;
    try {
      const fs = require("fs");
      const path = require("path");
      const backendDir = __dirname;
      const logoPath = path.join(backendDir, "../../src/assets/images/logos/simples.png");

      if (fs.existsSync(logoPath)) {
        logoBuffer = fs.readFileSync(logoPath);
        console.log(`🎨 Logo carregado com sucesso`);
      }
    } catch (logoError) {
      console.warn("⚠️ Aviso: Logo não encontrado");
    }

    // Posição na página
    const x = horizontalSpacing;
    const y = verticalSpacing;

    // Gera código de barras
    const barcodeText = posicao.codigo_barras || posicao.posicao_codigo;
    const barcodeImage = await generateBarcode(barcodeText);

    console.log(`🎨 Desenhando placa de posição`);

    // Desenha o container (borda)
    doc.rect(x, y, cardWidth, cardHeight).stroke();

    // 1️⃣ LOGO NO TOPO (centralizado)
    if (logoBuffer) {
      try {
        const logoWidth = 28;
        const logoHeight = 42;
        const logoX = x + (cardWidth - logoWidth) / 2;
        const logoY = y + 10;
        
        doc.image(logoBuffer, logoX, logoY, {
          width: logoWidth,
          height: logoHeight,
        });
      } catch (imageError) {
        console.warn("⚠️ Aviso: Erro ao adicionar logo");
      }
    }

    // 2️⃣ INFORMAÇÕES PRINCIPAIS (RUA, MÓDULO, NÍVEL)
    const infoStartY = y + 65;
    const labelX = x + 8;
    const valueX = x + 60;
    const lineSpacing = 20;

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("RUA:", labelX, infoStartY)
      .text("MÓD:", labelX, infoStartY + lineSpacing)
      .text("NÍV:", labelX, infoStartY + lineSpacing * 2);

    doc
      .fontSize(11)
      .font("Helvetica")
      .text(posicao.rua_codigo || "-", valueX, infoStartY)
      .text(posicao.modulo_codigo || "-", valueX, infoStartY + lineSpacing)
      .text(posicao.nivel_codigo || "-", valueX, infoStartY + lineSpacing * 2);

    // 3️⃣ CÓDIGO DA POSIÇÃO (Destaque)
    const posicaoY = infoStartY + lineSpacing * 3 + 15;
    doc
      .fontSize(26)
      .font("Helvetica-Bold")
      .fillColor("#0ea5e9")
      .text(posicao.posicao_codigo, x + 10, posicaoY, {
        width: cardWidth - 20,
        align: "center",
      })
      .fillColor("black");

    // 4️⃣ CÓDIGO DE BARRAS
    const barcodeY = y + cardHeight - 115;
    
    if (barcodeImage) {
      const barcodeWidth = 140;
      const barcodeHeight = 60;
      const barcodeX = x + (cardWidth - barcodeWidth) / 2;
      
      doc.image(barcodeImage, barcodeX, barcodeY, {
        width: barcodeWidth,
        height: barcodeHeight,
      });

      // Texto abaixo do código de barras
      doc
        .fontSize(9)
        .font("Helvetica")
        .text(barcodeText, x + 10, barcodeY + barcodeHeight + 3, {
          width: cardWidth - 20,
          align: "center",
        });
    }

    console.log(`✅ PDF da posição gerado com sucesso - finalizado`);
    doc.end();
  } catch (error) {
    console.error("❌ Erro fatal ao gerar PDF da posição:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao gerar PDF da posição: " + error.message });
    }
    if (doc) {
      doc.end();
    }
  }
});



// Router para qualidade
const qualidadeRouter = express.Router();
app.use("/api/qualidade", qualidadeRouter);

// Middleware para autenticação nas rotas de qualidade
qualidadeRouter.use(autenticarToken);

// Rotas para Máquinas
qualidadeRouter.get("/maquinas", async (req, res) => {
  try {
    const { tipo } = req.query;
    let query = "SELECT * FROM maquinas WHERE ativo = true";
    const params = [];

    if (tipo) {
      query += " AND tipo_maquina = $1";
      params.push(tipo.toUpperCase());
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar máquinas" });
  }
});

// Rotas para Produtos
qualidadeRouter.get("/produtos", async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT id, descricao as ds_produto, referencia as referencia_produto 
      FROM produtos_cache
    `;

    const params = [];
    if (search && search.length >= 2) {
      // Só filtra se tiver 2+ caracteres
      query += ` WHERE descricao ILIKE $1 OR referencia ILIKE $1`;
      params.push(`%${search}%`);
    } else {
      return res.json([]); // Retorna vazio se busca muito curta
    }

    query += ` ORDER BY descricao LIMIT 20`; // Limita resultados

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ message: "Erro ao buscar produtos" });
  }
});

// Rotas para Checklist
app.get("/checklist/modelo/:tipo", async (req, res) => {
  try {
    const { tipo } = req.params;
    const result = await pool.query(
      `SELECT m.*, json_agg(i.*) as itens 
       FROM checklist_modelos m
       JOIN checklist_itens i ON m.id = i.modelo_id
       WHERE m.nome ILIKE $1 AND m.ativo = true
       GROUP BY m.id`,
      [`%${tipo}%`],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Modelo de checklist não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar modelo de checklist" });
  }
});

// Modifique a rota que busca o modelo de checklist
qualidadeRouter.get("/checklist/modelo", async (req, res) => {
  const { maquinaId, produtoId } = req.query;

  try {
    // 1. Buscar tipo da máquina
    const maquinaResult = await pool.query(
      `SELECT tipo_maquina FROM maquinas WHERE id = $1 AND ativo = true`,
      [maquinaId],
    );

    if (maquinaResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Máquina não encontrada ou inativa",
      });
    }

    // Determinar o tipo de processo baseado no tipo da máquina
    const tipoMaquina = maquinaResult.rows[0].tipo_maquina;
    const tipoProcesso = tipoMaquina.includes("INJETORA")
      ? "INJECAO"
      : tipoMaquina.includes("MONTAGEM")
        ? "MONTAGEM"
        : tipoMaquina.includes("EMBALAGEM")
          ? "EMBALAGEM"
          : "INJECAO"; // Default

    // 2. Buscar modelo correspondente
    const modeloResult = await pool.query(
      `SELECT id FROM checklist_modelos 
       WHERE tipo_processo = $1 AND ativo = true
       LIMIT 1`,
      [tipoProcesso],
    );

    if (modeloResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Nenhum modelo de checklist disponível para este tipo de máquina",
      });
    }

    // 3. Buscar itens do modelo
    const itensResult = await pool.query(
      `SELECT 
        i.id, i.descricao, i.tipo, i.instrucao, 
        i.parametro, i.instrumento, i.unidade, 
        i.valor_ideal as "valorIdeal", i.codigo_defeito as "codigoDefeito",
        (
          SELECT json_agg(json_build_object(
            'codigo', d.codigo,
            'descricao', d.descricao,
            'categoria', d.categoria,
            'gravidade', d.gravidade
          ))
          FROM defeitos_injecao d
          WHERE d.codigo = i.codigo_defeito OR i.codigo_defeito IS NULL
        ) as defeitos,
        (
          SELECT json_agg(json_build_object(
            'codigo', 'NC' || nc.id,
            'descricao', nc.descricao,
            'gravidade', nc.gravidade
          ))
          FROM nao_conformidades nc
        ) as nao_conformidades
       FROM checklist_itens i
       WHERE i.modelo_id = $1
       ORDER BY i.ordem`,
      [modeloResult.rows[0].id],
    );

    // Organizar em etapas
    const etapas = organizarEmEtapas(itensResult.rows);

    res.json({
      success: true,
      etapas,
    });
  } catch (err) {
    console.error("Erro ao buscar modelo:", err);
    res.status(500).json({
      success: false,
      message: "Erro interno ao buscar modelo de checklist",
    });
  }
});

// Rota para registrar checklist completo
qualidadeRouter.post("/checklist/registrar", async (req, res) => {
  const client = await pool.connect();

  try {
    const { maquinaId, produtoId, operadorId, resultados, fotos, checklistId } =
      req.body;

    // Validação básica
    if (!maquinaId || !produtoId || !operadorId) {
      return res.status(400).json({
        success: false,
        message: "IDs de máquina, produto ou operador faltando",
      });
    }

    await client.query("BEGIN");

    // Verificar existência dos recursos
    const [maquina, produto, operador] = await Promise.all([
      client.query("SELECT id FROM maquinas WHERE id = $1 AND ativo = true", [
        maquinaId,
      ]),
      client.query("SELECT id FROM produtos_cache WHERE id = $1", [produtoId]),
      client.query("SELECT id FROM operadores WHERE id = $1", [operadorId]),
    ]);

    if (
      maquina.rows.length === 0 ||
      produto.rows.length === 0 ||
      operador.rows.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message: "Recurso não encontrado",
        details: {
          maquina: maquina.rows.length === 0,
          produto: produto.rows.length === 0,
          operador: operador.rows.length === 0,
        },
      });
    }

    let execucaoId;

    // Lógica para checklist existente
    if (checklistId) {
      // 1. Verificar se o checklist existe e está em andamento
      const checkExistente = await client.query(
        `SELECT id FROM checklist_execucoes 
         WHERE id = $1 AND status = 'em_andamento' AND operador_id = $2
         FOR UPDATE`, // Bloqueia o registro para evitar concorrência
        [checklistId, operadorId],
      );

      if (checkExistente.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Checklist não encontrado ou já finalizado",
        });
      }

      execucaoId = checklistId;

      // 2. Atualizar o status diretamente para concluído
      await client.query(
        `UPDATE checklist_execucoes 
         SET status = 'concluido', 
             data_finalizacao = NOW(),
             produto_id = $1
         WHERE id = $2`,
        [produtoId, checklistId],
      );

      // 3. Limpar respostas anteriores
      await client.query(
        "DELETE FROM checklist_respostas WHERE execucao_id = $1",
        [execucaoId],
      );
    }
    // Lógica para novo checklist
    else {
      // Verificar se já existe um checklist em andamento para evitar duplicação
      const checkAndamento = await client.query(
        `SELECT id FROM checklist_execucoes 
         WHERE operador_id = $1 AND status = 'em_andamento'
         LIMIT 1`,
        [operadorId],
      );

      if (checkAndamento.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Já existe um checklist em andamento para este operador",
          checklistId: checkAndamento.rows[0].id,
        });
      }

      const insertResult = await client.query(
        `INSERT INTO checklist_execucoes 
         (maquina_id, produto_id, operador_id, data_hora, status) 
         VALUES ($1, $2, $3, NOW(), 'concluido') 
         RETURNING id`,
        [maquinaId, produtoId, operadorId],
      );
      execucaoId = insertResult.rows[0].id;
    }

    // Função auxiliar para registrar respostas
    const registrarResposta = async (itemId, tipo, valores) => {
      let defeitoId = null;
      if (valores.defeito?.codigo) {
        const defeitoResult = await client.query(
          "SELECT id FROM defeitos_injecao WHERE codigo = $1",
          [valores.defeito.codigo],
        );
        defeitoId = defeitoResult.rows[0]?.id || null;
      }

      const queryText = `
        INSERT INTO checklist_respostas (
          execucao_id, item_id, tipo_resposta, valor_resposta,
          conformidade, defeito_id, nao_conformidade_id, 
          observacao, acao_corretiva, maquina_id,
          cavidades_paradas, tempo_ciclo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;

      const values = [
        execucaoId,
        itemId,
        tipo,
        JSON.stringify(valores),
        valores.conforme,
        defeitoId,
        valores.naoConformidade?.id || null,
        valores.observacao?.substring(0, 500) || null,
        (valores.acaoCorretiva || valores.acaoImediata)?.substring(0, 500) ||
          null,
        maquinaId,
        valores.cavidadesParadas ?? null,
        valores.tempoCiclo ?? null,
      ];

      return client.query(queryText, values);
    };

    // Registrar defeitos
    for (const defeito of resultados.defeitos || []) {
      await registrarResposta(defeito.itemId, "defeito", {
        conforme: false,
        defeito: { codigo: defeito.codigo },
        observacao: defeito.observacoes,
        acaoCorretiva: defeito.acaoImediata,
      });
    }

    // Registrar inspeções
    for (const [itemIdStr, inspecao] of Object.entries(
      resultados.inspecoes || {},
    )) {
      const itemId = Number(itemIdStr);
      await registrarResposta(itemId, "inspecao", {
        conforme: inspecao.conforme,
        defeito: inspecao.defeito || null,
        naoConformidade: inspecao.naoConformidade || null,
        observacao: inspecao.observacao,
        cavidadesParadas: inspecao.cavidadesParadas ?? null,
        tempoCiclo: inspecao.tempoCiclo ?? null,
      });
    }

    // Registrar parâmetros
    for (const parametro of resultados.parametros || []) {
      await registrarResposta(parametro.itemId, "parametro", {
        valor: parametro.valor,
        descricao: parametro.descricao,
        conforme: true,
      });
    }

    // Registrar fotos
    if (fotos?.length > 0) {
      await Promise.all(
        fotos.map((foto) => {
          if (!foto.caminho) return Promise.resolve();

          return client.query(
            `INSERT INTO checklist_fotos 
             (checklist_id, caminho, data_hora)
             VALUES ($1, $2, $3)`,
            [
              execucaoId,
              foto.caminho,
              foto.data_hora || new Date().toISOString(),
            ],
          );
        }),
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      execucaoId,
      isUpdate: !!checklistId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro no servidor:", err);
    res.status(500).json({
      success: false,
      message: "Erro durante o processamento",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  } finally {
    client.release();
  }
});

// Rotas para Defeitos
qualidadeRouter.get("/defeitos", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        codigo,
        descricao,
        categoria,
        gravidade
      FROM defeitos_injecao
      ORDER BY codigo
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar defeitos" });
  }
});

qualidadeRouter.get("/nao-conformidades", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        'NC' || id::text as codigo,
        descricao,
        gravidade
      FROM nao_conformidades
      ORDER BY id
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar não conformidades" });
  }
});

app.get("/checklist/maquina/:id/recentes", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT c.id, c.data_hora, o.nome as operador, 
       COUNT(r.id) as total_itens,
       SUM(CASE WHEN r.conformidade = false THEN 1 ELSE 0 END) as nao_conformidades
       FROM checklist_execucoes c
       JOIN operadores o ON c.operador_id = o.id
       LEFT JOIN checklist_respostas r ON c.id = r.execucao_id
       WHERE c.maquina_id = $1
       GROUP BY c.id, o.nome
       ORDER BY c.data_hora DESC
       LIMIT 5`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erro ao buscar checklists recentes" });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/checklist-fotos";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `checklist-${uniqueSuffix}-${file.originalname}`);
  },
});

const uploadFoto = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.match(/\/(jpg|jpeg|png)$/)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Tipo de arquivo não suportado. Apenas JPG, JPEG e PNG são permitidos.",
        ),
        false,
      );
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Rota para upload de fotos
app.post(
  "/api/qualidade/upload-foto",
  uploadFoto.single("foto"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado" });
      }

      // Aqui você pode processar a foto se necessário
      const fotoUrl = `/checklist-fotos/${req.file.filename}`;

      res.json({
        success: true,
        caminho: fotoUrl,
        nomeArquivo: req.file.filename,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erro ao processar upload da foto" });
    }
  },
);

qualidadeRouter.post("/checklist/iniciar", async (req, res) => {
  const { maquinaId, produtoId, operadorId } = req.body;

  // Validação dos IDs
  if (
    !Number.isInteger(maquinaId) ||
    !Number.isInteger(produtoId) ||
    !Number.isInteger(operadorId)
  ) {
    return res.status(400).json({
      message: "IDs devem ser números inteiros",
      details: {
        maquinaId: typeof maquinaId,
        produtoId: typeof produtoId,
        operadorId: typeof operadorId,
      },
    });
  }

  try {
    // Consulta otimizada com JOIN para melhor performance
    const queryResult = await pool.query(
      `
      SELECT 
        m.id AS maquina_id, m.tipo_maquina AS maquina_codigo,
        p.id AS produto_id, p.referencia AS produto_referencia,
        o.id AS operador_id, o.nome AS operador_nome
      FROM 
        (SELECT id, tipo_maquina FROM maquinas WHERE id = $1 AND ativo = true) m,
        (SELECT id, referencia FROM produtos_cache WHERE id = $2) p,
        (SELECT id, nome FROM operadores WHERE id = $3) o
    `,
      [maquinaId, produtoId, operadorId],
    );

    if (queryResult.rows.length === 0) {
      // Verifica especificamente qual recurso não foi encontrado
      const [maquina, produto, operador] = await Promise.all([
        pool.query("SELECT id FROM maquinas WHERE id = $1", [maquinaId]),
        pool.query("SELECT id FROM produtos_cache WHERE id = $1", [produtoId]),
        pool.query("SELECT id FROM operadores WHERE id = $1", [operadorId]),
      ]);

      return res.status(404).json({
        message: "Recurso não encontrado",
        details: {
          maquina: maquina.rows.length === 0,
          produto: produto.rows.length === 0,
          operador: operador.rows.length === 0,
        },
      });
    }

    const resultado = queryResult.rows[0];

    // Inserção do checklist
    const insertResult = await pool.query(
      `INSERT INTO checklist_execucoes 
       (maquina_id, produto_id, operador_id, data_hora, status) 
       VALUES ($1, $2, $3, NOW(), 'em_andamento') 
       RETURNING id`,
      [maquinaId, produtoId, operadorId],
    );

    res.status(201).json({
      id: insertResult.rows[0].id,
      maquina: {
        id: resultado.maquina_id,
        tipo: resultado.tipo_maquina,
      },
      produto: {
        id: resultado.produto_id,
        referencia: resultado.produto_referencia,
      },
      operador: {
        id: resultado.operador_id,
        nome: resultado.operador_nome,
      },
    });
  } catch (error) {
    console.error("Erro no servidor:", error);
    res.status(500).json({
      message: "Erro interno no servidor",
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  }
});

// server.js - Adicione estas rotas

// Rotas para produtos
app.get("/api/enderecamento/produtos", autenticarToken, async (req, res) => {
  try {
    const { limit, offset, search } = req.query;

    let query = `
      SELECT p.*, 
        u_compra.codigo as unidade_compra_codigo,
        u_consumo.codigo as unidade_consumo_codigo
      FROM produtos p
      LEFT JOIN unidades u_compra ON p.id_unidade_compra = u_compra.id
      LEFT JOIN unidades u_consumo ON p.id_unidade_consumo = u_consumo.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (p.referencia_produto ILIKE $${params.length + 1} OR p.ds_produto ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    query += " ORDER BY p.referencia_produto";

    if (limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));
    }
    if (offset) {
      query += ` OFFSET $${params.length + 1}`;
      params.push(parseInt(offset));
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).json({ error: "Erro ao buscar produtos" });
  }
});

// Buscar produto por ID
app.get(
  "/api/enderecamento/produtos/:id",
  autenticarToken,
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
      SELECT p.*, 
        u_compra.codigo as unidade_compra_codigo,
        u_consumo.codigo as unidade_consumo_codigo
      FROM produtos p
      LEFT JOIN unidades u_compra ON p.id_unidade_compra = u_compra.id
      LEFT JOIN unidades u_consumo ON p.id_unidade_consumo = u_consumo.id
      WHERE p.id = $1
    `,
        [id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Erro ao buscar produto:", error);
      res.status(500).json({ error: "Erro ao buscar produto" });
    }
  },
);

// 🔹 BUSCAR PRODUTO POR EAN/REFERÊNCIA (ROTA CORRIGIDA)
app.get(
  "/api/enderecamento/produtos/por-ean/:codigo",
  autenticarToken,
  async (req, res) => {
    try {
      const { codigo } = req.params;

      const result = await pool.query(
        `
      SELECT p.*, 
        u_compra.codigo as unidade_compra_codigo,
        u_consumo.codigo as unidade_consumo_codigo
      FROM produtos p
      LEFT JOIN unidades u_compra ON p.id_unidade_compra = u_compra.id
      LEFT JOIN unidades u_consumo ON p.id_unidade_consumo = u_consumo.id
      WHERE p.ean13 = $1 OR p.referencia_produto = $1
      ORDER BY 
        CASE WHEN p.ean13 = $1 THEN 1 ELSE 2 END
      LIMIT 1
    `,
        [codigo],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Erro ao buscar produto por código:", error);
      res.status(500).json({ error: "Erro ao buscar produto" });
    }
  },
);

// Criar produto
app.post("/api/enderecamento/produtos", autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      referencia_produto,
      ds_produto,
      ean13,
      id_unidade_compra,
      id_unidade_consumo,
      fator_conversao_compra_consumo,
      tempo_padrao_montagem_segundos,
      tempo_padrao_embalagem_segundos,
      tempo_padrao_injecao_segundos,
      meta_horaria_montagem,
      meta_horaria_embalagem,
      meta_horaria_injecao,
      pecas_por_ciclo,
    } = req.body;

    // Validar referência única
    const referenciaExistente = await client.query(
      "SELECT id FROM produtos WHERE referencia_produto = $1",
      [referencia_produto],
    );

    if (referenciaExistente.rows.length > 0) {
      throw new Error("Referência do produto já existe");
    }

    // Validar EAN único se fornecido
    if (ean13) {
      const eanExistente = await client.query(
        "SELECT id FROM produtos WHERE ean13 = $1",
        [ean13],
      );

      if (eanExistente.rows.length > 0) {
        throw new Error("EAN13 já existe");
      }
    }

    // Inserir produto
    const result = await client.query(
      `
      INSERT INTO produtos (
        referencia_produto, ds_produto, ean13, id_unidade_compra, id_unidade_consumo,
        fator_conversao_compra_consumo, tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos, tempo_padrao_injecao_segundos,
        meta_horaria_montagem, meta_horaria_embalagem, meta_horaria_injecao,
        pecas_por_ciclo, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
      RETURNING *
    `,
      [
        referencia_produto,
        ds_produto,
        ean13,
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
        pecas_por_ciclo,
      ],
    );

    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar produto:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Atualizar produto
app.put(
  "/api/enderecamento/produtos/:id",
  autenticarToken,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const { id } = req.params;
      const {
        referencia_produto,
        ds_produto,
        ean13,
        id_unidade_compra,
        id_unidade_consumo,
        fator_conversao_compra_consumo,
        tempo_padrao_montagem_segundos,
        tempo_padrao_embalagem_segundos,
        tempo_padrao_injecao_segundos,
        meta_horaria_montagem,
        meta_horaria_embalagem,
        meta_horaria_injecao,
        pecas_por_ciclo,
      } = req.body;

      // Validar se produto existe
      const produtoExistente = await client.query(
        "SELECT id FROM produtos WHERE id = $1",
        [id],
      );

      if (produtoExistente.rows.length === 0) {
        throw new Error("Produto não encontrado");
      }

      // Validar referência única (excluindo o próprio produto)
      const referenciaExistente = await client.query(
        "SELECT id FROM produtos WHERE referencia_produto = $1 AND id != $2",
        [referencia_produto, id],
      );

      if (referenciaExistente.rows.length > 0) {
        throw new Error("Referência do produto já existe");
      }

      // Validar EAN único se fornecido (excluindo o próprio produto)
      if (ean13) {
        const eanExistente = await client.query(
          "SELECT id FROM produtos WHERE ean13 = $1 AND id != $2",
          [ean13, id],
        );

        if (eanExistente.rows.length > 0) {
          throw new Error("EAN13 já existe");
        }
      }

      // Atualizar produto
      const result = await client.query(
        `
      UPDATE produtos 
      SET referencia_produto = $1, ds_produto = $2, ean13 = $3, 
          id_unidade_compra = $4, id_unidade_consumo = $5,
          fator_conversao_compra_consumo = $6, 
          tempo_padrao_montagem_segundos = $7,
          tempo_padrao_embalagem_segundos = $8,
          tempo_padrao_injecao_segundos = $9,
          meta_horaria_montagem = $10, meta_horaria_embalagem = $11,
          meta_horaria_injecao = $12, pecas_por_ciclo = $13,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `,
        [
          referencia_produto,
          ds_produto,
          ean13,
          id_unidade_compra,
          id_unidade_consumo,
          fator_conversao_compra_consumo,
          tempo_padrao_montagem_segundos,
          tempo_padrao_embalagem_segundos,
          tempo_padrao_injecao_segundos,
          meta_horaria_montagem,
          meta_horaria_embalagem,
          meta_horaria_injecao,
          pecas_por_ciclo,
          id,
        ],
      );

      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao atualizar produto:", error);
      res.status(500).json({ error: error.message });
    } finally {
      client.release();
    }
  },
);

// Validar referência única
app.get(
  "/api/enderecamento/produtos/validar-referencia",
  autenticarToken,
  async (req, res) => {
    try {
      const { referencia, excluir_id } = req.query;

      let query = "SELECT id FROM produtos WHERE referencia_produto = $1";
      const params = [referencia];

      if (excluir_id) {
        query += " AND id != $2";
        params.push(excluir_id);
      }

      const result = await pool.query(query, params);

      res.json({
        valido: result.rows.length === 0,
        mensagem: result.rows.length > 0 ? "Referência já existe" : undefined,
      });
    } catch (error) {
      console.error("Erro ao validar referência:", error);
      res.status(500).json({ error: "Erro ao validar referência" });
    }
  },
);

// Validar EAN único
app.get(
  "/api/enderecamento/produtos/validar-ean",
  autenticarToken,
  async (req, res) => {
    try {
      const { ean13, excluir_id } = req.query;

      if (!ean13) {
        return res.json({ valido: true });
      }

      let query = "SELECT id FROM produtos WHERE ean13 = $1";
      const params = [ean13];

      if (excluir_id) {
        query += " AND id != $2";
        params.push(excluir_id);
      }

      const result = await pool.query(query, params);

      res.json({
        valido: result.rows.length === 0,
        mensagem: result.rows.length > 0 ? "EAN13 já existe" : undefined,
      });
    } catch (error) {
      console.error("Erro ao validar EAN:", error);
      res.status(500).json({ error: "Erro ao validar EAN" });
    }
  },
);

// Rota para verificar produto no cache
qualidadeRouter.get("/produtos/verificar/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        existe: false,
        valido: false,
        message: "ID do produto inválido",
      });
    }

    const result = await pool.query(
      `SELECT 
        EXISTS(SELECT 1 FROM produtos_cache WHERE id = $1) AS "existe",
        (SELECT ativo FROM produtos WHERE id = $1) AS "valido"
      `,
      [id],
    );

    const { existe, valido } = result.rows[0];

    res.json({
      existe,
      valido: valido !== false,
      success: true,
    });
  } catch (err) {
    console.error("Erro ao verificar produto:", err);
    res.status(500).json({
      existe: false,
      valido: false,
      message: "Erro interno ao verificar produto",
    });
  }
});

qualidadeRouter.get("/produtos/total", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) AS total FROM produtos_cache",
    );
    res.json({
      total: parseInt(result.rows[0].total),
      success: true,
    });
  } catch (err) {
    console.error("Erro ao contar produtos:", err);
    res.status(500).json({
      total: 0,
      success: false,
    });
  }
});

// Rota para buscar produto específico por ID
qualidadeRouter.get("/produtos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validação básica do ID
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: "ID do produto inválido",
      });
    }

    const result = await pool.query(
      `SELECT 
        id, 
        descricao as ds_produto, 
        referencia as referencia_produto
      FROM produtos_cache 
      WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Produto não encontrado",
      });
    }

    res.json({
      success: true,
      produto: result.rows[0],
    });
  } catch (err) {
    console.error("Erro ao buscar produto por ID:", err);
    res.status(500).json({
      success: false,
      message: "Erro interno ao buscar produto",
    });
  }
});

// Rota para obter tipo de processo da máquina
qualidadeRouter.get("/maquinas/:id/tipo-processo", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        CASE
          WHEN tipo_maquina LIKE '%INJETORA%' THEN 'INJECAO'
          WHEN tipo_maquina LIKE '%MONTAGEM%' THEN 'MONTAGEM'
          WHEN tipo_maquina LIKE '%EMBALAGEM%' THEN 'EMBALAGEM'
          ELSE 'INJECAO'
        END as tipo_processo
       FROM maquinas 
       WHERE id = $1 AND ativo = true`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Máquina não encontrada",
      });
    }

    res.json({
      success: true,
      tipo: result.rows[0].tipo_processo,
    });
  } catch (err) {
    console.error("Erro ao buscar tipo de processo:", err);
    res.status(500).json({
      success: false,
      message: "Erro interno ao buscar tipo de processo",
    });
  }
});

// Função auxiliar para determinar o tipo de processo
async function determinarTipoProcesso(maquina) {
  // 1. Tenta buscar do banco se existir coluna específica
  const result = await pool.query(
    `SELECT tipo_processo FROM maquinas WHERE id = $1`,
    [maquina.id],
  );
  if (result.rows[0]?.tipo_processo) {
    return result.rows[0].tipo_processo;
  }

  // 1. Verifica por termos específicos na descrição
  if (descricao.includes("EMBAL") || descricao.includes("PACK")) {
    return "EMBALAGEM";
  }
  if (descricao.includes("MONT") || descricao.includes("ASSEMBLY")) {
    return "MONTAGEM";
  }

  // 2. Verifica no tipo_maquina
  if (
    tipo.includes("INJETORA") ||
    tipo.includes("INJECAO") ||
    tipo.includes("MOLDING")
  ) {
    return "INJECAO";
  }
  if (tipo.includes("MONTAGEM") || tipo.includes("ASSEMBLY")) {
    return "MONTAGEM";
  }
  if (tipo.includes("EMBALAGEM") || tipo.includes("PACKAGING")) {
    return "EMBALAGEM";
  }

  // 3. Fallback baseado em padrões comuns
  if (tipo.includes("EXT") || tipo.includes("MOLD")) {
    return "INJECAO";
  }
  if (descricao.includes("LINE") || descricao.includes("LINHA")) {
    return "MONTAGEM";
  }

  // 4. Default para injeção (mais comum em indústria plástica)
  return "INJECAO";
}

qualidadeRouter.post("/checklist/iniciar", async (req, res) => {
  // Adicionar verificação de existência do modelo de checklist
  const modeloCheck = await pool.query(
    `SELECT id FROM checklist_modelos 
     WHERE tipo_processo = $1 AND ativo = true`,
    [tipoProcesso],
  );

  if (modeloCheck.rows.length === 0) {
    return res.status(404).json({
      success: false,
      message:
        "Nenhum modelo de checklist disponível para este tipo de máquina",
    });
  }
});

// Upload de foto
qualidadeRouter.post(
  "/checklist/:id/fotos",
  uploadFoto.single("foto"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { itemId, descricao } = req.body;

      await pool.query(
        `INSERT INTO checklist_fotos 
       (checklist_id, caminho, descricao, item_id)
       VALUES ($1, $2, $3, $4)`,
        [id, req.file.path, descricao, itemId],
      );

      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false });
    }
  },
);

// Buscar fotos
qualidadeRouter.get("/checklist/:id/fotos", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, caminho, descricao, data_hora, item_id
       FROM checklist_fotos
       WHERE checklist_id = $1`,
      [id],
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// Rota para buscar checklist em andamento
qualidadeRouter.get(
  "/checklist/em-andamento/operador/:operadorId",
  async (req, res) => {
    try {
      const { operadorId } = req.params;

      const result = await pool.query(
        `SELECT 
        ce.id,
        ce.data_hora as "dataHora",
        ce.status,
        json_build_object(
          'id', m.id,
          'tipo_maquina', m.tipo_maquina,
          'tipo_maquina', m.tipo_maquina,
          'descricao', m.descricao
        ) as maquina,
        json_build_object(
          'id', p.id,
          'referencia', p.referencia,
          'ds_produto', p.descricao
        ) as produto,
        json_build_object(
          'id', o.id,
          'nome', o.nome
        ) as operador
       FROM checklist_execucoes ce
       JOIN maquinas m ON ce.maquina_id = m.id
       JOIN produtos_cache p ON ce.produto_id = p.id
       JOIN operadores o ON ce.operador_id = o.id
       WHERE ce.operador_id = $1 AND ce.status = 'em_andamento'
       ORDER BY ce.data_hora DESC
       LIMIT 1`,
        [operadorId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Nenhum checklist em andamento",
        });
      }

      const checklist = result.rows[0];

      // Busca as respostas
      const respostas = await pool.query(
        `SELECT 
        item_id as "itemId",
        tipo_resposta as "tipoResposta",
        valor_resposta as "valorResposta"
       FROM checklist_respostas
       WHERE execucao_id = $1`,
        [checklist.id],
      );

      // Processa as respostas
      const resultados = {
        defeitos: [],
        parametros: [],
        inspecoes: {},
        observacoes: "",
      };

      respostas.rows.forEach((resposta) => {
        const valor = JSON.parse(resposta.valorResposta);

        if (resposta.tipoResposta === "defeito") {
          resultados.defeitos.push({
            itemId: resposta.itemId,
            ...valor.defeito,
            observacoes: valor.observacoes,
          });
        } else if (resposta.tipoResposta === "parametro") {
          resultados.parametros.push({
            itemId: resposta.itemId,
            valor: valor.valor,
            descricao: valor.descricao,
          });
        } else if (resposta.tipoResposta === "inspecao") {
          resultados.inspecoes[resposta.itemId] = {
            conforme: valor.conforme,
            defeito: valor.defeito || null,
            naoConformidade: valor.naoConformidade || null,
            observacao: valor.observacao || "",
          };
        }
      });

      // Busca fotos se necessário
      const fotos = await pool.query(
        `SELECT 
        caminho as data,
        descricao,
        data_hora as "dataHora"
       FROM checklist_fotos
       WHERE checklist_id = $1`,
        [checklist.id],
      );

      res.json({
        ...checklist,
        resultados,
        fotos: fotos.rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Erro ao buscar checklist em andamento",
      });
    }
  },
);

qualidadeRouter.patch("/checklist/:id/cancelar", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE checklist_execucoes 
       SET status = 'cancelado', data_finalizacao = NOW()
       WHERE id = $1 AND status = 'em_andamento'
       RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Checklist não encontrado ou já finalizado",
      });
    }

    res.json({
      success: true,
      message: "Checklist cancelado com sucesso",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Erro ao cancelar checklist",
    });
  }
});

router.get("/tipos-movimentacao", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tipos_movimentacao WHERE ativo = true ORDER BY descricao",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar tipos de movimentação:", error);
    res.status(500).json({ error: "Erro ao buscar tipos de movimentação" });
  }
});

// Rota para registrar entrada/saída
router.post("/movimentacoes", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      tipo_movimentacao_id,
      produto_id,
      posicao_id,
      quantidade,
      documento,
      operador_id,
      observacao,
    } = req.body;

    // 1. Obter o id_original correspondente ao id_cache (se necessário)
    const produtoResult = await client.query(
      `SELECT 
        p.id as id_original,
        p.id_cache
      FROM produtos p
      WHERE p.id = $1 OR p.id_cache = $1`,
      [produto_id],
    );

    if (produtoResult.rows.length === 0) {
      throw new Error(
        `Produto com ID ${produto_id} não encontrado em produtos ou produtos_cache`,
      );
    }

    const produto = produtoResult.rows[0];
    const produto_id_original = produto.id_original || produto.id;
    const produto_id_cache = produto.id_cache || produto.id;

    // 2. Verificar posição
    const posicaoExiste = await client.query(
      "SELECT id FROM posicoes WHERE id = $1",
      [posicao_id],
    );
    if (posicaoExiste.rows.length === 0) {
      throw new Error(`Posição com ID ${posicao_id} não encontrada`);
    }

    // 3. Registrar movimentação usando o id_original
    const movResult = await client.query(
      `INSERT INTO movimentacoes_estoque (
        tipo_movimentacao_id, produto_id, posicao_id,
        quantidade, documento, operador_id, observacao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        tipo_movimentacao_id,
        produto_id_original,
        posicao_id,
        quantidade,
        documento,
        operador_id,
        observacao,
      ],
    );

    // 4. Atualizar estoque usando o id_original
    const operacao = await client.query(
      "SELECT operacao FROM tipos_movimentacao WHERE id = $1",
      [tipo_movimentacao_id],
    );

    if (operacao.rows[0].operacao === "E") {
      await client.query(
        `INSERT INTO estoque (
          produto_id, posicao_id, quantidade, operador_id
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (produto_id, posicao_id)
        DO UPDATE SET
          quantidade = estoque.quantidade + $3,
          data_atualizacao = NOW(),
          operador_id = $4`,
        [produto_id_original, posicao_id, quantidade, operador_id],
      );
    } else {
      const estoqueAtual = await client.query(
        `UPDATE estoque
         SET quantidade = quantidade - $1,
             data_atualizacao = NOW(),
             operador_id = $4
         WHERE produto_id = $2 AND posicao_id = $3
         AND quantidade >= $1
         RETURNING *`,
        [quantidade, produto_id_original, posicao_id, operador_id],
      );

      if (estoqueAtual.rowCount === 0) {
        throw new Error(
          "Estoque insuficiente ou produto não encontrado na posição",
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json({
      ...movResult.rows[0],
      produto_id_original,
      produto_id_cache,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro detalhado:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
    });
    res.status(400).json({
      error: error.message,
      details: `IDs envolvidos - Produto original: ${produto_id_original}, Cache: ${produto_id_cache}`,
    });
  } finally {
    client.release();
  }
});

router.get("/posicao/:produtoId/:posicaoId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT quantidade FROM estoque
       WHERE produto_id = $1 AND posicao_id = $2`,
      [req.params.produtoId, req.params.posicaoId],
    );

    res.json({
      quantidade: result.rows[0]?.quantidade || 0,
    });
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ error: "Erro ao consultar estoque" });
  }
});

// Rota para histórico de movimentações
router.get("/movimentacoes/posicoes-analise", async (req, res) => {
  try {
    const {
      produto_id,
      posicao_id,
      tipo_movimentacao_id,
      operador_id,
      data_inicio,
      data_fim,
      limit = 20,
    } = req.query;

    const params = [];
    const conditions = [];

    if (produto_id) {
      params.push(produto_id);
      conditions.push(`m.produto_id = $${params.length}`);
    }

    if (posicao_id) {
      params.push(posicao_id);
      conditions.push(`m.posicao_id = $${params.length}`);
    }

    if (tipo_movimentacao_id) {
      params.push(tipo_movimentacao_id);
      conditions.push(`m.tipo_movimentacao_id = $${params.length}`);
    }

    if (operador_id) {
      params.push(operador_id);
      conditions.push(`m.operador_id = $${params.length}`);
    }

    if (data_inicio) {
      params.push(data_inicio);
      conditions.push(`m.data_hora >= $${params.length}`);
    }

    if (data_fim) {
      params.push(data_fim);
      conditions.push(`m.data_hora <= $${params.length}`);
    }

    const limite = Math.max(1, Math.min(Number(limit) || 20, 100));
    params.push(limite);

    const query = `
      SELECT
        m.posicao_id,
        po.codigo AS posicao_codigo,
        COUNT(*) AS total_movimentacoes,
        SUM(CASE WHEN t.operacao = 'E' THEN 1 ELSE 0 END) AS total_entradas,
        SUM(CASE WHEN t.operacao = 'S' THEN 1 ELSE 0 END) AS total_saidas,
        COALESCE(SUM(CASE WHEN t.operacao = 'E' THEN ABS(m.quantidade) ELSE 0 END), 0) AS volume_entrada,
        COALESCE(SUM(CASE WHEN t.operacao = 'S' THEN ABS(m.quantidade) ELSE 0 END), 0) AS volume_saida,
        COALESCE(SUM(ABS(m.quantidade)), 0) AS volume_total,
        COUNT(DISTINCT m.produto_id) AS produtos_distintos,
        COUNT(DISTINCT m.operador_id) AS operadores_distintos,
        MAX(m.data_hora) AS ultima_movimentacao
      FROM movimentacoes_estoque m
      JOIN tipos_movimentacao t ON m.tipo_movimentacao_id = t.id
      JOIN posicoes po ON m.posicao_id = po.id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      GROUP BY m.posicao_id, po.codigo
      ORDER BY volume_total DESC, total_movimentacoes DESC, po.codigo ASC
      LIMIT $${params.length}
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar análise de posições:", error);
    res.status(500).json({ error: "Erro ao buscar análise de posições" });
  }
});

router.get("/movimentacoes", async (req, res) => {
  try {
    const {
      produto_id,
      posicao_id,
      tipo_movimentacao_id,
      operador_id,
      data_inicio,
      data_fim,
    } = req.query;

    let query = `
      SELECT m.*, t.descricao as tipo_movimentacao, t.operacao,
             p.referencia, p.descricao as produto_descricao,
             po.codigo as posicao_codigo, o.nome as operador_nome
      FROM movimentacoes_estoque m
      JOIN tipos_movimentacao t ON m.tipo_movimentacao_id = t.id
      JOIN produtos_cache p ON m.produto_id = p.id
      JOIN posicoes po ON m.posicao_id = po.id
      JOIN operadores o ON m.operador_id = o.id
    `;

    const params = [];
    const conditions = [];

    if (produto_id) {
      params.push(produto_id);
      conditions.push(`m.produto_id = $${params.length}`);
    }

    if (posicao_id) {
      params.push(posicao_id);
      conditions.push(`m.posicao_id = $${params.length}`);
    }

    if (tipo_movimentacao_id) {
      params.push(tipo_movimentacao_id);
      conditions.push(`m.tipo_movimentacao_id = $${params.length}`);
    }

    if (operador_id) {
      params.push(operador_id);
      conditions.push(`m.operador_id = $${params.length}`);
    }

    if (data_inicio) {
      params.push(data_inicio);
      conditions.push(`m.data_hora >= $${params.length}`);
    }

    if (data_fim) {
      params.push(data_fim);
      conditions.push(`m.data_hora <= $${params.length}`);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY m.data_hora DESC LIMIT 100";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar movimentações:", error);
    res.status(500).json({ error: "Erro ao buscar movimentações" });
  }
});

app.get("/api/estoque/ruas", async (req, res) => {
  try {
    const { id_local_estoque } = req.query;

    let query = `
      SELECT DISTINCT r.* 
      FROM ruas r
      JOIN modulos m ON r.id = m.id_rua
      JOIN niveis n ON m.id = n.id_modulo
      JOIN posicoes p ON n.id = p.id_nivel
      WHERE 1=1
    `;

    const params = [];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND p.id_local_estoque = $1`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY r.codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar ruas:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/estoque/ruas/:id_rua/modulos", async (req, res) => {
  try {
    const { id_rua } = req.params;
    const { id_local_estoque } = req.query;

    let query = `
      SELECT DISTINCT m.* 
      FROM modulos m
      JOIN niveis n ON m.id = n.id_modulo
      JOIN posicoes p ON n.id = p.id_nivel
      WHERE m.id_rua = $1
    `;

    const params = [id_rua];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND p.id_local_estoque = $2`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY m.codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar módulos:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/estoque/modulos/:id_modulo/niveis", async (req, res) => {
  try {
    const { id_modulo } = req.params;
    const { id_local_estoque } = req.query;

    let query = `
      SELECT DISTINCT n.* 
      FROM niveis n
      JOIN posicoes p ON n.id = p.id_nivel
      WHERE n.id_modulo = $1
    `;

    const params = [id_modulo];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND p.id_local_estoque = $2`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY n.codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar níveis:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.get("/api/estoque/niveis/:id_nivel/posicoes", async (req, res) => {
  try {
    const { id_nivel } = req.params;
    const { id_local_estoque } = req.query;

    let query = `SELECT * FROM posicoes WHERE id_nivel = $1`;
    const params = [id_nivel];

    if (id_local_estoque && !isNaN(id_local_estoque)) {
      query += ` AND id_local_estoque = $2`;
      params.push(parseInt(id_local_estoque));
    }

    query += " ORDER BY codigo";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar posições:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

app.post("/api/estoque/movimentacoes", async (req, res) => {
  try {
    const {
      tipo,
      produto_id,
      posicao_id,
      quantidade,
      documento,
      operador_id,
      observacao,
    } = req.body;

    // Validar dados
    if (
      !["entrada", "saida"].includes(tipo) ||
      !produto_id ||
      !posicao_id ||
      !quantidade ||
      !operador_id
    ) {
      return res.status(400).json({ error: "Dados inválidos ou incompletos" });
    }

    // Registrar movimentação
    const result = await pool.query(
      `INSERT INTO movimentacoes_estoque (
        tipo, produto_id, posicao_id, quantidade, 
        documento, operador_id, observacao
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        tipo,
        produto_id,
        posicao_id,
        quantidade,
        documento || null,
        operador_id,
        observacao || null,
      ],
    );

    // Atualizar estoque
    if (tipo === "entrada") {
      await pool.query(
        `INSERT INTO contagem_estoque (produto_id, posicao_id, quantidade)
         VALUES ($1, $2, $3)
         ON CONFLICT (produto_id, posicao_id) 
         DO UPDATE SET quantidade = contagem_estoque.quantidade + $3`,
        [produto_id, posicao_id, quantidade],
      );
    } else {
      await pool.query(
        `UPDATE contagem_estoque 
         SET quantidade = quantidade - $1
         WHERE produto_id = $2 AND posicao_id = $3
         AND quantidade >= $1`,
        [quantidade, produto_id, posicao_id],
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Erro ao registrar movimentação:", error);
    res.status(500).json({ error: "Erro ao registrar movimentação" });
  }
});

// AJUSTE DE ESTOQUE PELO INVENTÁRIO
router.post("/inventario/ajustar", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { inventario_id, operador_id } = req.body;

    // 1. Buscar contagens não finalizadas
    const contagens = await client.query(
      `SELECT * FROM contagem_estoque 
       WHERE id_inventario = $1 AND contagem_finalizada = false`,
      [inventario_id],
    );

    // 2. Processar cada contagem
    for (const contagem of contagens.rows) {
      // Verificar se o produto existe
      const produto = await client.query(
        `SELECT id FROM produtos WHERE id = $1 OR id_cache = $1`,
        [contagem.id_produto],
      );

      if (produto.rows.length === 0) {
        console.warn(
          `Produto ${contagem.id_produto} não encontrado - Contagem ID ${contagem.id}`,
        );
        continue;
      }

      const produto_id = produto.rows[0].id;

      // 3. Atualizar estoque operacional
      await client.query(
        `INSERT INTO estoque (
          produto_id, posicao_id, quantidade, operador_id, id_local_estoque
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (produto_id, posicao_id)
        DO UPDATE SET
          quantidade = $3,
          data_atualizacao = NOW(),
          operador_id = $4`,
        [
          produto_id,
          contagem.id_posicao,
          contagem.quantidade_pacotes,
          operador_id,
          contagem.id_local_estoque,
        ],
      );

      // 4. Marcar contagem como finalizada
      await client.query(
        `UPDATE contagem_estoque 
         SET contagem_finalizada = true,
             data_hora = NOW()
         WHERE id = $1`,
        [contagem.id],
      );
    }

    await client.query("COMMIT");
    res.status(200).json({
      message: `${contagens.rowCount} contagens processadas com sucesso`,
      contagens_processadas: contagens.rowCount,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao ajustar inventário:", error);
    res.status(500).json({
      error: "Erro ao ajustar inventário",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

app.get("/apontamento/dados-graficos", async (req, res) => {
  try {
    const umaSemanaAtras = new Date();
    umaSemanaAtras.setDate(umaSemanaAtras.getDate() - 7);

    // Lista de referências de produtos a serem excluídos
    const produtosExcluir = [
      "01007041",
      "01007043",
      "01007044",
      "01007046",
      "01007047",
      "01007048",
      "01007049",
      "01007050",
      "01007051",
      "01007060",
      "01007063",
      "01007069",
    ];

    // Top 5 operadores por turno (última semana) - EXCLUINDO PRODUTOS ESPECÍFICOS
    const topOperadoresPorTurno = await pool.query(
      `
      SELECT 
        o.turno,
        o.nome as operador_nome,
        COALESCE(SUM(ap.quantidade_pecas), 0) as total_pecas,
        COUNT(ap.id) as total_apontamentos
      FROM apontamento_producao ap
      JOIN operadores o ON ap.id_operador = o.id
      JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.status = 'FINALIZADO' 
      AND ap.data_fim >= $1
      AND o.turno IN ('Turno A', 'Turno B', 'Turno C')
      AND p.referencia_produto NOT IN ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      GROUP BY o.turno, o.nome
      ORDER BY o.turno, total_pecas DESC
    `,
      [umaSemanaAtras, ...produtosExcluir],
    );
    // Organizar dados por turno - CORRIGIDO para normalizar os nomes dos turnos
    const topOperadores = {
      turnoA: [],
      turnoB: [],
      turnoC: [],
    };

    topOperadoresPorTurno.rows.forEach((row) => {
      const operadorData = {
        nome: row.operador_nome,
        totalPecas: parseInt(row.total_pecas),
        totalApontamentos: parseInt(row.total_apontamentos),
      };

      if (row.turno === "Turno A" && topOperadores.turnoA.length < 5) {
        topOperadores.turnoA.push(operadorData);
      } else if (row.turno === "Turno B" && topOperadores.turnoB.length < 5) {
        topOperadores.turnoB.push(operadorData);
      } else if (row.turno === "Turno C" && topOperadores.turnoC.length < 5) {
        topOperadores.turnoC.push(operadorData);
      }
    });

    // Eficiência por turno - TAMBÉM EXCLUINDO PRODUTOS ESPECÍFICOS
    const eficienciaTurno = await pool.query(
      `
      SELECT o.turno, 
             AVG(CASE WHEN ap.status = 'FINALIZADO' THEN ap.quantidade_pecas / NULLIF(EXTRACT(EPOCH FROM (ap.data_fim - ap.data_inicio)) / 3600, 0) ELSE 0 END) as eficiencia
      FROM apontamento_producao ap
      JOIN operadores o ON ap.id_operador = o.id
      JOIN produtos p ON ap.id_produto = p.id
      WHERE ap.data_inicio >= CURRENT_DATE - INTERVAL '7 days'
      AND ap.status = 'FINALIZADO'
      AND p.referencia_produto NOT IN ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      GROUP BY o.turno
    `,
      produtosExcluir,
    );

    const eficienciaPorTurno = {
      turnoA: 0,
      turnoB: 0,
      turnoC: 0,
    };

    eficienciaTurno.rows.forEach((row) => {
      if (row.turno === "Turno A")
        eficienciaPorTurno.turnoA = parseFloat(row.eficiencia) || 0;
      if (row.turno === "Turno B")
        eficienciaPorTurno.turnoB = parseFloat(row.eficiencia) || 0;
      if (row.turno === "Turno C")
        eficienciaPorTurno.turnoC = parseFloat(row.eficiencia) || 0;
    });

    res.json({
      topOperadores,
      eficienciaPorTurno,
    });
  } catch (error) {
    console.error("Erro ao buscar dados para gráficos:", error);
    // Retornar estrutura vazia em caso de erro
    res.json({
      topOperadores: { turnoA: [], turnoB: [], turnoC: [] },
      eficienciaPorTurno: { turnoA: 0, turnoB: 0, turnoC: 0 },
    });
  }
});

app.post(
  "/apontamento/imprimir-codigo-barras",
  autenticarToken,
  async (req, res) => {
    const { id_produto, quantidade } = req.body;

    try {
      // 1. Buscar informações do produto
      const produtoQuery = await pool.query(
        `
      SELECT p.id, p.referencia_produto, p.ds_produto, 
             COALESCE(e.ean14, p.ean13) AS codigo_barras
      FROM produtos p
      LEFT JOIN produtos_ean14 e ON p.id = e.id_produto
      WHERE p.id = $1
      LIMIT 1
    `,
        [id_produto],
      );

      if (produtoQuery.rows.length === 0) {
        await registrarLogImpressao({
          id_produto,
          codigo_barras: null,
          comandos: null,
          status: "produto_nao_encontrado",
        });
        return res.status(404).json({ message: "Produto não encontrado" });
      }

      const produto = produtoQuery.rows[0];

      // 2. Gerar comandos PPLA para impressora Argox
      const comandos = gerarComandosArgox(produto, quantidade);

      // Registrar log ANTES de enviar para impressora
      await registrarLogImpressao({
        id_produto,
        codigo_barras: produto.codigo_barras,
        comandos: comandos, // Armazena os comandos exatos que serão enviados
        status: "enviando",
      });

      // 3. Enviar para a impressora
      const resultado = await enviarParaImpressora(comandos);

      // Registrar log após sucesso
      await registrarLogImpressao({
        id_produto,
        codigo_barras: produto.codigo_barras,
        comandos: comandos,
        status: "enviado_com_sucesso",
      });

      res.status(200).json({
        success: true,
        message: "Código de barras enviado para impressão",
        produto,
        resultado,
      });
    } catch (err) {
      // Registrar log de erro
      await registrarLogImpressao({
        id_produto,
        codigo_barras: produto?.codigo_barras || null,
        comandos: comandos || null,
        status: "erro",
        erro: err.message,
      });

      console.error("Erro ao imprimir código de barras:", err);
      res.status(500).json({
        message: "Erro ao imprimir código de barras",
        error: err.message,
      });
    }
  },
);

// Função para gerar comandos PPLA
function gerarComandosArgox(produto, quantidade) {
  // 1. Remove todos os caracteres não-ASCII e formata
  const formatarTexto = (texto) =>
    texto
      .toString()
      .replace(/[^\x20-\x7E]/g, "")
      .substring(0, 30);

  // 2. Garante código de barras válido
  const codigo = (produto.codigo_barras || "0000000000000")
    .toString()
    .replace(/\D/g, "")
    .padStart(13, "0")
    .substring(0, 13);

  // 3. Comandos PPLA absolutamente básicos (sem aspas problemáticas)
  return (
    [
      "\x1B@", // Initialize
      "SIZE 25 mm, 50 mm",
      "GAP 2 mm, 0 mm",
      "DIRECTION 1",
      "CLS",
      `TEXT 20,30,"0",0,1,1,"${produto.descricao.substring(0, 30)}"`,
      `BARCODE 20,60,"128",60,1,0,2,2,"${produto.codigo_barras}"`,
      `TEXT 20,130,"0",0,1,1,"${produto.codigo_barras}"`,
      "PRINT 1",
    ].join("\n") + "\n"
  ); // Adiciona quebra de linha final
}

async function enviarParaImpressora(comandos) {
  const net = require("net");
  const printerIP = "192.168.10.220";
  const printerPort = 9100;

  return new Promise((resolve, reject) => {
    const client = new net.Socket();

    // Configuração especial para Argox
    client.setKeepAlive(true, 1000);
    client.setNoDelay(true);

    client.connect(printerPort, printerIP, () => {
      // Envia com quebra de linha CR+LF (exigência da Argox)
      client.write(
        comandos.replace(/\n/g, "\r\n") + "\r\n",
        "binary",
        (err) => {
          client.destroy();
          if (err) return reject(err);
          resolve({ success: true });
        },
      );
    });

    client.setTimeout(3000);
    client.on("error", reject);
    client.on("timeout", () => reject(new Error("Timeout")));
  });
}

app.get("/verificar-impressora", autenticarToken, async (req, res) => {
  try {
    const net = require("net");
    const printerIP = "192.168.10.220";
    const printerPort = 9100;

    const client = new net.Socket();

    client.setTimeout(3000);

    client.connect(printerPort, printerIP, () => {
      client.destroy();
      res.status(200).json({
        status: "online",
        message: "Impressora respondendo na porta 9100",
      });
    });

    client.on("error", (err) => {
      res.status(500).json({
        status: "offline",
        message: "Não foi possível conectar à impressora",
        error: err.message,
      });
    });

    client.on("timeout", () => {
      res.status(500).json({
        status: "timeout",
        message: "Timeout ao tentar conectar à impressora",
      });
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Erro ao verificar impressora",
      error: err.message,
    });
  }
});

async function registrarLogImpressao(dados) {
  try {
    await pool.query(
      "INSERT INTO logs_impressao (id_produto, codigo_barras, comandos, data_hora, status) VALUES ($1, $2, $3, NOW(), $4)",
      [dados.id_produto, dados.codigo_barras, dados.comandos, dados.status],
    );
  } catch (err) {
    console.error("Erro ao registrar log de impressão:", err);
  }
}

app.get("/logs-impressao", autenticarToken, async (req, res) => {
  try {
    const { limit = 50, id_produto } = req.query;

    let query = "SELECT * FROM logs_impressao ORDER BY data_hora DESC LIMIT $1";
    let params = [limit];

    if (id_produto) {
      query =
        "SELECT * FROM logs_impressao WHERE id_produto = $1 ORDER BY data_hora DESC LIMIT $2";
      params = [id_produto, limit];
    }

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Erro ao buscar logs", error: err.message });
  }
});

app.post("/enviar-comandos-raw", autenticarToken, async (req, res) => {
  const { comandos } = req.body;

  try {
    const resultado = await enviarParaImpressora(comandos);
    res.status(200).json({ success: true, resultado });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Falha ao enviar comandos",
      error: err.message,
      stack: err.stack,
    });
  }
});

app.post("/operadores/login-tv", async (req, res) => {
  try {
    // Verificar se é uma solicitação válida de TV
    const { username, password } = req.body;

    if (username === "allison" && password === "251115") {
      // Buscar um operador real ou criar um fictício
      const result = await pool.query(
        "SELECT * FROM operadores WHERE nome = $1 LIMIT 1",
        ["TV_DASHBOARD"],
      );

      let operador;
      if (result.rows.length > 0) {
        operador = result.rows[0];
      } else {
        // Criar um operador fictício para TV
        operador = {
          id: 999,
          nome: "TV_DASHBOARD",
          administrador: true,
          tipo_operador: "Gestão",
          turno: "Turno A",
        };
      }

      const token = jwt.sign(
        {
          id: operador.id,
          nome: operador.nome,
          administrador: operador.administrador,
          tipo_operador: operador.tipo_operador,
          isTvDashboard: true,
        },
        process.env.SECRET_KEY || "secreto",
        { expiresIn: "30d" }, // 30 dias para TV
      );

      return res.status(200).json({ token, operador });
    }

    res.status(401).json({ message: "Credenciais TV inválidas" });
  } catch (err) {
    console.error("Erro no login TV:", err);
    res.status(500).json({ message: "Erro no servidor" });
  }
});

// Renovar token para Dashboard TV
app.post("/operadores/renew-tv-token", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const oldToken = authHeader && authHeader.split(" ")[1];

    if (!oldToken) {
      return res.status(401).json({ message: "Token não fornecido" });
    }

    let decoded;
    try {
      // Aceitar tokens expirados para renovação TV (ignoreExpiration)
      decoded = jwt.verify(oldToken, process.env.SECRET_KEY || "secreto", {
        ignoreExpiration: true,
      });
    } catch (err) {
      return res.status(403).json({ message: "Token inválido" });
    }

    // Somente tokens marcados como TV ou com usuário TV_DASHBOARD
    if (!decoded.isTvDashboard && decoded.nome !== "TV_DASHBOARD") {
      return res.status(403).json({ message: "Renovação disponível somente para token TV" });
    }

    const newToken = jwt.sign(
      {
        id: decoded.id,
        nome: decoded.nome,
        administrador: decoded.administrador,
        tipo_operador: decoded.tipo_operador,
        isTvDashboard: true,
      },
      process.env.SECRET_KEY || "secreto",
      { expiresIn: "30d" },
    );

    console.log(`📺 Token TV renovado para: ${decoded.nome}`);
    return res.status(200).json({ token: newToken });
  } catch (err) {
    console.error("Erro ao renovar token TV:", err);
    res.status(500).json({ message: "Erro no servidor" });
  }
});

// Buscar pedidos prontos para despacho
app.get("/api/pedidos-prontos-despacho", autenticarToken, async (req, res) => {
  try {
    const { data_inicio, data_fim, filial } = req.query;

    let query = `
      SELECT 
        id as pedidovendaid,
        nr_nota_pedidovenda,
        dt_faturamento_pedidovenda,
        dt_entdesejada_pedidovenda,
        cliente_nome,
        cidade as nome_cidade,
        uf as uf_cidade,
        valor_total,
        peso_bruto,
        peso_liquido,
        volumes,
        filialid,
        observacoes,
        data_despacho_prevista_atualizada as data_despacho_prevista,
        status_despacho,
        prioridade,
        data_atualizacao
      FROM vw_pedidos_despacho_completo
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (data_inicio) {
      paramCount++;
      query += ` AND dt_faturamento_pedidovenda >= $${paramCount}`;
      params.push(data_inicio);
    }

    if (data_fim) {
      paramCount++;
      query += ` AND dt_faturamento_pedidovenda <= $${paramCount}`;
      params.push(data_fim);
    }

    if (filial) {
      paramCount++;
      query += ` AND filialid = $${paramCount}`;
      params.push(parseInt(filial));
    }

    query += ` ORDER BY 
      CASE prioridade 
        WHEN 'VERMELHO' THEN 1
        WHEN 'LARANJA' THEN 2
        WHEN 'AMARELO' THEN 3
        WHEN 'VERDE' THEN 4
      END,
      dt_faturamento_pedidovenda ASC`;

    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar pedidos prontos para despacho:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar pedidos", details: error.message });
  }
});

// Atualizar data de despacho prevista e calcular data de separação
app.put(
  "/api/pedidos-despacho/:id/data-prevista",
  autenticarToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { data_despacho_prevista } = req.body;

      if (!data_despacho_prevista) {
        return res.status(400).json({ error: "Data e hora de despacho sao obrigatorias" });
      }

      const dataBaseSeparacao = String(data_despacho_prevista).replace(' ', 'T').split('T')[0];
      const dataValida = new Date(dataBaseSeparacao);

      if (Number.isNaN(dataValida.getTime())) {
        return res.status(400).json({ error: "Data de despacho invalida" });
      }

      // Calcular data de início de separação (3 dias úteis antes)
      const dataInicioSeparacao = await calcularDataInicioSeparacao(dataBaseSeparacao);
      const dataInicioFormatada = dataInicioSeparacao.toISOString().split('T')[0];

      // Atualizar tabela pedidos_despacho_previsto
      const result = await pool.query(
        `
      INSERT INTO pedidos_despacho_previsto (pedidovendaid, data_despacho_prevista, usuario_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (pedidovendaid) 
      DO UPDATE SET 
        data_despacho_prevista = $2,
        usuario_id = $3,
        data_atualizacao = NOW()
      RETURNING *
    `,
        [id, data_despacho_prevista, req.user.id],
      );

      // Atualizar tabela separacao_pedidos com data_inicio_separacao
      try {
        const updateSeparacao = await pool.query(
          `
        UPDATE separacao_pedidos 
        SET 
          data_inicio_separacao = $1,
          data_prioridade_separacao = $1,
          updated_at = NOW()
        WHERE pedidovendaid = $2
        RETURNING *
      `,
          [dataInicioFormatada, id],
        );

        console.log(`✅ Despacho atualizado: Pedido ${id} | Despacho: ${data_despacho_prevista} | Separação: ${dataInicioFormatada}`);

        res.json({
          success: true,
          message: "Data de despacho e separação atualizadas com sucesso",
          data: {
            despacho: result.rows[0],
            separacao: updateSeparacao.rows[0] || null,
            data_inicio_separacao: dataInicioFormatada,
          },
        });
      } catch (updateError) {
        console.warn('⚠️ Tabela separacao_pedidos ainda não existe ou não foi encontrado o pedido');
        // Não falhar se separacao_pedidos não existir ainda
        res.json({
          success: true,
          message: "Data de despacho atualizada com sucesso",
          data: {
            despacho: result.rows[0],
            data_inicio_separacao: dataInicioFormatada,
          },
        });
      }
    } catch (error) {
      console.error("❌ Erro ao atualizar data de despacho:", error);
      res
        .status(500)
        .json({ error: "Erro ao atualizar data", details: error.message });
    }
  },
);

// Atualizar materialized view
app.post("/api/atualizar-view-despachos", autenticarToken, async (req, res) => {
  try {
    await pool.query("SELECT atualizar_pedidos_despacho_mv()");
    res.json({
      success: true,
      message: "Materialized View atualizada com sucesso",
    });
  } catch (error) {
    console.error("❌ Erro ao atualizar materialized view:", error);
    res
      .status(500)
      .json({ error: "Erro ao atualizar view", details: error.message });
  }
});

// NOVO: Sincronizar datas de despacho com datas de separação
app.post("/api/sincronizar-datas-separacao", autenticarToken, async (req, res) => {
  try {
    console.log('🔄 Iniciando sincronização de datas de separação...');

    // Buscar todos os pedidos com data de despacho prevista
    const pedidosQuery = `
      SELECT DISTINCT
        pdp.pedidovendaid,
        pdp.data_despacho_prevista
      FROM pedidos_despacho_previsto pdp
      LEFT JOIN separacao_pedidos sp ON pdp.pedidovendaid = sp.pedidovendaid
      WHERE pdp.data_despacho_prevista IS NOT NULL
      AND (sp.data_inicio_separacao IS NULL OR sp.data_inicio_separacao != (pdp.data_despacho_prevista - INTERVAL '5 days'))
      ORDER BY pdp.data_despacho_prevista DESC
    `;

    const result = await pool.query(pedidosQuery);
    const pedidos = result.rows;

    console.log(`📋 Encontrados ${pedidos.length} pedidos para sincronizar`);

    let atualizados = 0;
    const erros = [];

    for (const pedido of pedidos) {
      try {
        // Calcular data de separação
        const dataInicioSeparacao = await calcularDataInicioSeparacao(pedido.data_despacho_prevista);
        const dataInicioFormatada = dataInicioSeparacao.toISOString().split('T')[0];

        // Atualizar separacao_pedidos
        const updateResult = await pool.query(
          `
          UPDATE separacao_pedidos 
          SET 
            data_inicio_separacao = $1,
            data_prioridade_separacao = $1,
            updated_at = NOW()
          WHERE pedidovendaid = $2
          RETURNING pedidovendaid, data_inicio_separacao
        `,
          [dataInicioFormatada, pedido.pedidovendaid],
        );

        if (updateResult.rows.length > 0) {
          atualizados++;
          console.log(`✅ Pedido ${pedido.pedidovendaid}: Despacho ${pedido.data_despacho_prevista} → Separação ${dataInicioFormatada}`);
        }
      } catch (erro) {
        erros.push({
          pedidovendaid: pedido.pedidovendaid,
          erro: erro.message,
        });
        console.error(`❌ Erro ao processar pedido ${pedido.pedidovendaid}:`, erro.message);
      }
    }

    res.json({
      success: true,
      message: `Sincronização concluída: ${atualizados} pedidos atualizados`,
      atualizados,
      total: pedidos.length,
      erros: erros.length > 0 ? erros : undefined,
    });
  } catch (error) {
    console.error("❌ Erro ao sincronizar datas:", error);
    res
      .status(500)
      .json({ error: "Erro ao sincronizar datas", details: error.message });
  }
});

// Criar materialized view e tabelas necessárias
app.get("/api/inicializar-sistema-despachos", async (req, res) => {
  try {
    // Verificar se a extensão dblink existe
    await pool.query("CREATE EXTENSION IF NOT EXISTS dblink");

    // Criar materialized view
    await pool.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS pedidos_prontos_despacho_mv AS 
      SELECT * FROM dblink(
        'dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000',
        'SELECT pedidovendaid::integer, nr_nota_pedidovenda::text, dt_faturamento_pedidovenda::timestamp,
                dt_entdesejada_pedidovenda::timestamp, c.nome_cadcftv::text as cliente_nome,
                cd.nome_cidade::text as cidade, cd.uf_cidade::text as uf,
                vl_total_pedidovenda::numeric as valor_total, vl_pesobruto_pedidovenda::numeric as peso_bruto,
                vl_pesoliq_pedidovenda::numeric as peso_liquido, qt_volume_pedidovenda::integer as volumes,
                pv.filialid::integer, 
                COALESCE(pv.obs_ped1_pedidovenda, pv.obs_ped2_pedidovenda)::text as observacoes,
                pv.status_pedidovenda::text as status_pedido,
                NULL::timestamp as data_despacho_prevista, ''PENDENTE''::text as status_despacho
         FROM pedidovenda pv
         LEFT JOIN cadcftv c ON pv.cadcftvid = c.cadcftvid
         LEFT JOIN endcadcftv ec ON c.cadcftvid = ec.cadcftvid
         LEFT JOIN cidade cd ON ec.cidadeid = cd.cidadeid
         LEFT JOIN despacho_pedidovenda dp ON pv.pedidovendaid = dp.pedidovendaid
         LEFT JOIN despacho d ON dp.despachoid = d.despachoid
         WHERE pv.status_pedidovenda = ''FATURADO''
           AND pv.dt_faturamento_pedidovenda IS NOT NULL
           AND pv.vl_pesobruto_pedidovenda > 0
           AND d.dt_hr_despacho IS NULL
           AND pv.empresaid = 1
           AND pv.filialid IN (1, 2)'
      ) t(
        pedidovendaid integer, nr_nota_pedidovenda text, dt_faturamento_pedidovenda timestamp,
        dt_entdesejada_pedidovenda timestamp, cliente_nome text, cidade text, uf text,
        valor_total numeric, peso_bruto numeric, peso_liquido numeric, volumes integer,
        filialid integer, observacoes text, status_pedido text,
        data_despacho_prevista timestamp, status_despacho text
      )
    `);

    // Criar índices
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_despacho_mv_id 
      ON pedidos_prontos_despacho_mv (pedidovendaid)
    `);

    // Criar tabela auxiliar
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos_despacho_previsto (
        pedidovendaid INTEGER PRIMARY KEY,
        data_despacho_prevista TIMESTAMP,
        usuario_id INTEGER,
        data_atualizacao TIMESTAMP DEFAULT NOW()
      )
    `);

    res.json({
      success: true,
      message: "Sistema de despachos inicializado com sucesso",
      details: {
        materialized_view: "pedidos_prontos_despacho_mv",
        tabela_auxiliar: "pedidos_despacho_previsto",
      },
    });
  } catch (error) {
    console.error("❌ Erro ao inicializar sistema de despachos:", error);
    res
      .status(500)
      .json({ error: "Erro ao inicializar sistema", details: error.message });
  }
});

// Agendamento automático para atualizar a MV a cada 30 minutos
setInterval(
  async () => {
    try {
      await pool.query("SELECT atualizar_pedidos_despacho_mv()");
      console.log(
        "🔄 Materialized View de despachos atualizada automaticamente",
      );
    } catch (error) {
      console.error("❌ Erro na atualização automática da MV:", error);
    }
  },
  30 * 60 * 1000,
); // 30 minutos

setInterval(
  async () => {
    try {
      await pool.query("SELECT atualizar_pedido_itens_aworks_simples_mv()");
      console.log("🔄 Cache local de itens de pedido para separação atualizado automaticamente");
    } catch (error) {
      console.error("❌ Erro na atualização automática do cache local de itens de separação:", error.message);
    }
  },
  10 * 60 * 1000,
); // 10 minutos

// ============================================
// ROTAS PARA SEPARAÇÃO DE PEDIDOS
// ============================================

const routerSeparacao = express.Router();

// Função auxiliar para garantir mapeamento de produtos
async function garantirMapeamentoProduto(
  produtoid_aworks,
  referencia,
  descricao,
  client,
) {
  // Verificar se já existe mapeamento
  const checkQuery = `
    SELECT id FROM produtos WHERE id_cache = $1
  `;

  const checkResult = await client.query(checkQuery, [produtoid_aworks]);

  // Buscar tp_produto do AWORKSDB se disponível (para manter sincronizado)
  let tp_produto_aworks = null;
  try {
    const tpProdutoQuery = `SELECT tp_produto FROM produto WHERE produtoid = $1 AND empresaid = 1`;
    const tpResult = await poolSeven.query(tpProdutoQuery, [produtoid_aworks]);
    if (tpResult.rows.length > 0) {
      tp_produto_aworks = tpResult.rows[0].tp_produto;
    }
  } catch (err) {
    console.warn(`⚠️ Erro ao buscar tp_produto do AWORKSDB para produtoid ${produtoid_aworks}:`, err.message);
  }

  if (checkResult.rows.length === 0) {
    // Criar produto se não existir (incluindo tp_produto)
    const insertQuery = `
      INSERT INTO produtos (referencia_produto, ds_produto, id_cache, tp_produto, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id_cache) DO UPDATE SET
        referencia_produto = EXCLUDED.referencia_produto,
        ds_produto = EXCLUDED.ds_produto,
        tp_produto = EXCLUDED.tp_produto,
        updated_at = NOW()
      RETURNING id
    `;

    const insertResult = await client.query(insertQuery, [
      referencia || `REF-${produtoid_aworks}`,
      descricao || `Produto ${produtoid_aworks}`,
      produtoid_aworks,
      tp_produto_aworks, // Novo campo
    ]);

    return insertResult.rows[0].id;
  }

  // Se o produto já existe, atualizar tp_produto se disponível
  if (tp_produto_aworks) {
    try {
      await client.query(
        `UPDATE produtos SET tp_produto = $1, updated_at = NOW() WHERE id_cache = $2`,
        [tp_produto_aworks, produtoid_aworks]
      );
    } catch (err) {
      console.warn(`⚠️ Erro ao atualizar tp_produto para id_cache ${produtoid_aworks}:`, err.message);
    }
  }

  return checkResult.rows[0].id;
}

// Middleware de autenticação
routerSeparacao.use(autenticarToken);

let sincronizacaoPedidosSeparacaoEmAndamento = null;
let ultimaSincronizacaoPedidosSeparacao = 0;
const INTERVALO_SINCRONIZACAO_PEDIDOS_SEPARACAO_MS = 2 * 60 * 1000;

async function sincronizarPedidosPendentesSeparacao() {
  if (sincronizacaoPedidosSeparacaoEmAndamento) {
    return sincronizacaoPedidosSeparacaoEmAndamento;
  }

  const sincronizarPendentesQuery = `
    INSERT INTO separacao_pedidos (
      pedidovendaid,
      nr_nota_fiscal,
      cliente_nome,
      status,
      observacoes,
      created_at,
      updated_at
    )
    SELECT DISTINCT ON (pd.nr_nota_pedidovenda)
      pd.id,
      pd.nr_nota_pedidovenda,
      pd.cliente_nome,
      'PENDENTE',
      'Sincronizado automaticamente na listagem de separação',
      NOW(),
      NOW()
    FROM vw_pedidos_despacho_completo pd
    WHERE NOT EXISTS (
      SELECT 1
      FROM separacao_pedidos sp_exist
      WHERE sp_exist.nr_nota_fiscal = pd.nr_nota_pedidovenda
    )
      AND EXISTS (
        SELECT 1
        FROM vw_pedido_itens_aworks_simples pi
        WHERE pi.pedidovendaid = pd.id
          AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
      )
    ORDER BY
      pd.nr_nota_pedidovenda,
      pd.dt_faturamento_pedidovenda DESC
    ON CONFLICT (pedidovendaid) DO NOTHING
  `;

  sincronizacaoPedidosSeparacaoEmAndamento = (async () => {
    const inicio = Date.now();
    const syncResult = await pool.query(sincronizarPendentesQuery);
    ultimaSincronizacaoPedidosSeparacao = Date.now();

    if (syncResult.rowCount > 0) {
      console.log(`🔄 Auto-sincronização de separação: ${syncResult.rowCount} pedido(s) incluído(s) em ${Date.now() - inicio}ms`);
    }

    return syncResult.rowCount || 0;
  })();

  try {
    return await sincronizacaoPedidosSeparacaoEmAndamento;
  } finally {
    sincronizacaoPedidosSeparacaoEmAndamento = null;
  }
}

setInterval(() => {
  sincronizarPedidosPendentesSeparacao().catch((error) => {
    console.error("❌ Erro na sincronização agendada de pedidos para separação:", error.message);
  });
}, INTERVALO_SINCRONIZACAO_PEDIDOS_SEPARACAO_MS);

// 1. PEDIDOS
routerSeparacao.get("/pedidos", async (req, res) => {
  try {
    const { status, prioridade, data_inicio, data_fim } = req.query;

    if (Date.now() - ultimaSincronizacaoPedidosSeparacao >= INTERVALO_SINCRONIZACAO_PEDIDOS_SEPARACAO_MS) {
      sincronizarPedidosPendentesSeparacao().catch((syncError) => {
        console.error("❌ Erro na auto-sincronização em background da separação:", syncError.message);
      });
    }

    let query = `
      WITH itens_finalizados AS (
        SELECT DISTINCT si.pedidovendaitemid
        FROM separacao_itens si
        WHERE si.status = 'FINALIZADO'
      ),
      itens_por_nota AS (
        SELECT
          COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(pd_agg.nr_nota_pedidovenda::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nota_ref_normalizada,
          COUNT(DISTINCT pi.pedidovendaitemid) FILTER (
            WHERE COALESCE(pi.quantidade_entrega, 0) > 0
          ) AS total_itens_original,
          COUNT(DISTINCT pi.pedidovendaitemid) FILTER (
            WHERE (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
          ) AS total_itens_ativos,
          COUNT(DISTINCT pi.pedidovendaitemid) FILTER (
            WHERE COALESCE(pi.quantidade_entrega, 0) > 0
              AND ifin.pedidovendaitemid IS NULL
          ) AS itens_pendentes,
          BOOL_AND(COALESCE(pi.quantidade_despachada, 0) >= pi.quantidade_entrega) AS totalmente_despachado
        FROM vw_pedido_itens_aworks_simples pi
        INNER JOIN vw_pedidos_despacho_completo pd_agg ON pd_agg.id = pi.pedidovendaid
        LEFT JOIN itens_finalizados ifin ON ifin.pedidovendaitemid = pi.pedidovendaitemid
        GROUP BY COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(pd_agg.nr_nota_pedidovenda::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0')
      ),
      separacao_metricas_nota AS (
        SELECT
          COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nota_ref_normalizada,
          COUNT(DISTINCT si.pedidovendaitemid) FILTER (
            WHERE si.status = 'FINALIZADO' OR COALESCE(si.quantidade_separada, 0) >= COALESCE(si.quantidade_solicitada, 0)
          ) AS itens_separados,
          COUNT(DISTINCT si.pedidovendaitemid) FILTER (WHERE si.quantidade_conferida > 0) AS itens_conferidos
        FROM separacao_pedidos sp
        LEFT JOIN separacao_itens si ON si.id_separacao_pedido = sp.id
        GROUP BY COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0')
      ),
      operadores_em_separacao AS (
        SELECT
          base.nota_ref_normalizada,
          ARRAY_AGG(DISTINCT base.nome_operador ORDER BY base.nome_operador)
            FILTER (WHERE base.nome_operador IS NOT NULL) AS operadores_separando
        FROM (
          SELECT
            COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nota_ref_normalizada,
            NULLIF(TRIM(o.nome), '') AS nome_operador
          FROM separacao_pedidos sp
          LEFT JOIN operadores o ON o.id = sp.id_operador
          WHERE sp.status = 'EM_SEPARACAO'

          UNION

          SELECT
            COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nota_ref_normalizada,
            NULLIF(TRIM(o.nome), '') AS nome_operador
          FROM separacao_pedidos sp
          INNER JOIN separacao_itens si ON si.id_separacao_pedido = sp.id
          LEFT JOIN operadores o ON o.id = si.id_operador_separacao
          WHERE si.status = 'SEPARANDO'
        ) base
        GROUP BY base.nota_ref_normalizada
      ),
      pedidos_base AS (
        SELECT
          sp.id,
          sp.pedidovendaid,
          sp.nr_nota_fiscal,
          sp.status,
          sp.id_operador,
          sp.data_inicio_separacao,
          sp.data_fim_separacao,
          sp.observacoes,
          sp.created_at,
          sp.updated_at,
          sp.data_prioridade_separacao,
          pd.nr_nota_pedidovenda AS nr_nota_fiscal_view,
          pd.cliente_nome AS cliente_nome,
          pd.cidade,
          pd.uf AS uf_cidade,
          pd.peso_bruto,
          pd.volumes,
          pd.prioridade,
          pd.dt_faturamento_pedidovenda,
          pd.data_despacho_prevista_atualizada AS data_despacho_prevista,
          COALESCE(sp.nr_nota_fiscal, pd.nr_nota_pedidovenda) AS nota_ref,
          COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(COALESCE(sp.nr_nota_fiscal, pd.nr_nota_pedidovenda)::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nota_ref_normalizada,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(COALESCE(sp.nr_nota_fiscal, pd.nr_nota_pedidovenda)::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0')
            ORDER BY sp.id ASC
          ) AS nota_rank
        FROM separacao_pedidos sp
        LEFT JOIN vw_pedidos_despacho_completo pd ON sp.pedidovendaid = pd.id
        WHERE 1=1
          AND pd.cliente_nome IS NOT NULL
          AND pd.cliente_nome != ''
    `;

    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND sp.status = $${paramCount}`;
      params.push(status);
    } else {
      query += ` AND sp.status != 'FINALIZADO'`;
    }

    if (prioridade) {
      paramCount++;
      query += ` AND pd.prioridade = $${paramCount}`;
      params.push(prioridade);
    }

    if (data_inicio) {
      paramCount++;
      query += ` AND pd.dt_faturamento_pedidovenda >= $${paramCount}`;
      params.push(data_inicio);
    }

    if (data_fim) {
      paramCount++;
      query += ` AND pd.dt_faturamento_pedidovenda <= $${paramCount}`;
      params.push(data_fim);
    }

    query += `
      )
      SELECT
        pb.id,
        pb.pedidovendaid,
        COALESCE(pb.nr_nota_fiscal, pb.nr_nota_fiscal_view) AS nr_nota_fiscal,
        pb.cliente_nome AS cliente_nome,
        pb.cidade,
        pb.uf_cidade,
        pb.peso_bruto,
        pb.volumes,
        pb.prioridade,
        pb.dt_faturamento_pedidovenda,
        pb.data_despacho_prevista,
        pb.data_prioridade_separacao,
        pb.status,
        pb.id_operador,
        pb.data_inicio_separacao,
        pb.data_fim_separacao,
        pb.observacoes,
        pb.created_at,
        pb.updated_at,
        CASE
          WHEN pb.data_prioridade_separacao IS NULL THEN 'ROXO'
          WHEN pb.data_prioridade_separacao < CURRENT_DATE THEN 'VERMELHO'
          WHEN pb.data_prioridade_separacao = CURRENT_DATE THEN 'VERMELHO'
          WHEN pb.data_prioridade_separacao <= CURRENT_DATE + INTERVAL '2 days' THEN 'LARANJA'
          WHEN pb.data_prioridade_separacao <= CURRENT_DATE + INTERVAL '5 days' THEN 'AMARELO'
          ELSE 'VERDE'
        END AS prioridade_separacao,
        COALESCE(ipn.total_itens_original, 0) AS total_itens,
        COALESCE(ipn.total_itens_ativos, 0) AS total_itens_ativos,
        COALESCE(smn.itens_separados, 0) AS itens_separados,
        COALESCE(smn.itens_conferidos, 0) AS itens_conferidos,
        COALESCE(ipn.itens_pendentes, 0) AS itens_pendentes,
        COALESCE(oes.operadores_separando, ARRAY[]::text[]) AS operadores_separando,
        COALESCE(array_length(oes.operadores_separando, 1), 0) AS total_operadores_separando
      FROM pedidos_base pb
      LEFT JOIN itens_por_nota ipn ON ipn.nota_ref_normalizada = pb.nota_ref_normalizada
      LEFT JOIN separacao_metricas_nota smn ON smn.nota_ref_normalizada = pb.nota_ref_normalizada
      LEFT JOIN operadores_em_separacao oes ON oes.nota_ref_normalizada = pb.nota_ref_normalizada
      WHERE pb.nota_rank = 1
        AND COALESCE(ipn.total_itens_original, 0) > 0
        AND COALESCE(ipn.total_itens_ativos, 0) > 0
        AND COALESCE(ipn.totalmente_despachado, false) = false
      ORDER BY 
        CASE pb.status 
          WHEN 'EM_SEPARACAO' THEN 1
          WHEN 'CONFERIDO' THEN 2
          WHEN 'PENDENTE' THEN 3
          ELSE 4
        END,
        -- Ordenar por prioridade de separação (calculada pela data)
        CASE 
          WHEN pb.data_prioridade_separacao IS NULL THEN 5
          WHEN pb.data_prioridade_separacao < CURRENT_DATE THEN 1
          WHEN pb.data_prioridade_separacao = CURRENT_DATE THEN 1
          WHEN pb.data_prioridade_separacao <= CURRENT_DATE + INTERVAL '2 days' THEN 2
          WHEN pb.data_prioridade_separacao <= CURRENT_DATE + INTERVAL '5 days' THEN 3
          ELSE 4
        END,
        pb.data_prioridade_separacao ASC NULLS LAST,
        pb.dt_faturamento_pedidovenda ASC
    `;

    console.log("📦 Executando query para buscar pedidos...");
  const inicioBuscaPedidos = Date.now();
    const result = await pool.query(query, params);
  console.log(`✅ Encontrados ${result.rowCount} pedidos para separação em ${Date.now() - inicioBuscaPedidos}ms`);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar pedidos para separação:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar pedidos", details: error.message });
  }
});

// Rota para inicializar/sincronizar pedidos automaticamente
routerSeparacao.post("/sincronizar", async (req, res) => {
  const client = await pool.connect();
  try {
    console.log("🔄 Iniciando sincronização COMPLETA de pedidos...");

    // 1. Primeiro, deletar a função existente se tiver problemas
    await client.query(
      "DROP FUNCTION IF EXISTS sincronizar_pedidos_separacao()",
    );

    // 2. Criar nova função SEM filtro de prioridade restritivo
    const createFunctionSQL = `
      CREATE OR REPLACE FUNCTION sincronizar_pedidos_separacao()
      RETURNS INTEGER AS $$
      DECLARE
        pedidos_inseridos INTEGER := 0;
      BEGIN
        -- Inserir TODOS os pedidos com itens pendentes
        INSERT INTO separacao_pedidos (
          pedidovendaid, 
          nr_nota_fiscal, 
          cliente_nome, 
          status, 
          observacoes,
          created_at
        )
        SELECT DISTINCT ON (pd.nr_nota_pedidovenda)
          pd.id,
          pd.nr_nota_pedidovenda,
          pd.cliente_nome,
          'PENDENTE',
          'Pedido ' || COALESCE(pd.prioridade, 'NÃO INFORMADA') || ' - Sincronizado: ' || NOW()::date,
          NOW()
        FROM vw_pedidos_despacho_completo pd
        WHERE NOT EXISTS (
          SELECT 1
          FROM separacao_pedidos sp_exist
          WHERE sp_exist.nr_nota_fiscal = pd.nr_nota_pedidovenda
        )
          AND EXISTS (
            SELECT 1 
            FROM vw_pedido_itens_aworks_simples pi 
            WHERE pi.pedidovendaid = pd.id
              AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
          )
        ORDER BY 
          pd.nr_nota_pedidovenda,
          CASE COALESCE(pd.prioridade, '')
            WHEN 'VERMELHO' THEN 1
            WHEN 'LARANJA' THEN 2
            WHEN 'AMARELO' THEN 3
            WHEN 'VERDE' THEN 4
            WHEN 'ROXO' THEN 5
            ELSE 6
          END,
          pd.dt_faturamento_pedidovenda
        ON CONFLICT (pedidovendaid) DO NOTHING;
        
        GET DIAGNOSTICS pedidos_inseridos = ROW_COUNT;
        
        RAISE NOTICE '✅ Sincronização concluída: % novos pedidos inseridos', pedidos_inseridos;
        
        RETURN pedidos_inseridos;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await client.query(createFunctionSQL);
    console.log("✅ Função sincronizar_pedidos_separacao() criada/atualizada");

    // 3. Executar a função
    const result = await client.query(
      "SELECT sincronizar_pedidos_separacao() as pedidos_inseridos",
    );
    const pedidosInseridos = result.rows[0].pedidos_inseridos;

    console.log(
      `📦 ${pedidosInseridos} novos pedidos inseridos na tabela separacao_pedidos`,
    );

    // 4. Verificar o resultado
    const pedidosVerificacao = await client.query(`
      SELECT 
        sp.id,
        sp.pedidovendaid,
        sp.nr_nota_fiscal,
        sp.cliente_nome,
        sp.status,
        pd.prioridade,
        (
          SELECT COUNT(*) 
          FROM vw_pedido_itens_aworks_simples pi 
          WHERE pi.pedidovendaid = sp.pedidovendaid
            AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
        ) as itens_pendentes
      FROM separacao_pedidos sp
      LEFT JOIN vw_pedidos_despacho_completo pd ON sp.pedidovendaid = pd.id
      ORDER BY sp.id DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      message: `Sincronização concluída!`,
      detalhes: {
        novos_pedidos: pedidosInseridos,
        total_na_tabela: pedidosVerificacao.rowCount,
        exemplos: pedidosVerificacao.rows,
        nota:
          pedidosInseridos === 0
            ? "Nenhum novo pedido foi sincronizado. Pode ser que todos os pedidos já estejam na tabela ou não tenham itens pendentes."
            : "Pedidos sincronizados com sucesso!",
      },
    });
  } catch (error) {
    console.error("❌ Erro ao sincronizar pedidos:", error);
    res.status(500).json({
      error: "Erro ao sincronizar pedidos",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  } finally {
    client.release();
  }
});

routerSeparacao.get("/pedidos/:id", async (req, res) => {
  try {
    const pedidovendaid = parseInt(req.params.id);

    console.log(`📋 Buscando detalhes do pedido ${pedidovendaid}`);

    const query = `
      WITH pedido_ref AS (
        SELECT
          nr_nota_pedidovenda,
          COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(nr_nota_pedidovenda::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nr_nota_normalizada
        FROM vw_pedidos_despacho_completo
        WHERE id = $1
        LIMIT 1
      )
      SELECT 
        sp.*,
        vw.nr_nota_pedidovenda,
        vw.cliente_nome,
        vw.cidade,
        vw.uf as uf_cidade,
        vw.peso_bruto,
        vw.volumes,
        vw.prioridade,
        vw.dt_faturamento_pedidovenda,
        vw.data_despacho_prevista_atualizada as data_despacho_prevista,
        
        -- Contar itens
        (
          SELECT COUNT(*)
          FROM vw_pedido_itens_aworks_simples pi
          INNER JOIN vw_pedidos_despacho_completo vw_agg ON vw_agg.id = pi.pedidovendaid
          INNER JOIN pedido_ref pr ON true
          WHERE vw_agg.nr_nota_pedidovenda = pr.nr_nota_pedidovenda
            AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
        ) as total_itens,
        
        -- Itens separados
        (SELECT COUNT(*) FROM separacao_itens si 
         WHERE si.id_separacao_pedido = sp.id 
           AND (si.status = 'FINALIZADO' OR si.quantidade_separada >= si.quantidade_solicitada)) as itens_separados,
        
        -- Itens conferidos
        (SELECT COUNT(*) FROM separacao_itens si 
         WHERE si.id_separacao_pedido = sp.id 
           AND si.quantidade_conferida > 0) as itens_conferidos
        
      FROM separacao_pedidos sp
      LEFT JOIN vw_pedidos_despacho_completo vw ON sp.pedidovendaid = vw.id
      WHERE COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') = (SELECT nr_nota_normalizada FROM pedido_ref)
      ORDER BY sp.id ASC
      LIMIT 1
    `;

    const result = await pool.query(query, [pedidovendaid]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pedido não encontrado" });
    }

    const pedido = result.rows[0];

    // Calcular progresso
    const totalItens = parseInt(pedido.total_itens) || 0;
    const itensSeparados = parseInt(pedido.itens_separados) || 0;
    const progresso =
      totalItens > 0 ? Math.round((itensSeparados / totalItens) * 100) : 0;

    res.json({
      ...pedido,
      progresso: progresso,
    });
  } catch (error) {
    console.error("❌ Erro ao buscar detalhes do pedido:", error);
    res.status(500).json({
      error: "Erro ao buscar detalhes",
      details: error.message,
    });
  }
});

// Atualizar data de prioridade de separação
routerSeparacao.put("/pedidos/:id/prioridade-separacao", async (req, res) => {
  try {
    const pedidoId = parseInt(req.params.id);
    const { data_prioridade_separacao } = req.body;

    console.log(`📅 Atualizando prioridade de separação do pedido ${pedidoId} para ${data_prioridade_separacao}`);

    if (!data_prioridade_separacao) {
      return res.status(400).json({ 
        error: "Data de prioridade é obrigatória" 
      });
    }

    const query = `
      UPDATE separacao_pedidos 
      SET 
        data_prioridade_separacao = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [data_prioridade_separacao, pedidoId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        error: "Pedido não encontrado" 
      });
    }

    console.log(`✅ Prioridade atualizada com sucesso`);

    res.json({
      success: true,
      message: "Prioridade de separação atualizada",
      pedido: result.rows[0]
    });

  } catch (error) {
    console.error("❌ Erro ao atualizar prioridade:", error);
    res.status(500).json({
      error: "Erro ao atualizar prioridade",
      details: error.message
    });
  }
});

routerSeparacao.post("/pedidos/:id/iniciar", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pedidovendaid = parseInt(req.params.id);
    const { id_operador } = req.body;

    console.log(
      `🚀 Iniciando separação para pedido ${pedidovendaid} pelo operador ${id_operador}`,
    );

    // 1. Buscar informações do pedido da view
    const pedidoQuery = `
      SELECT 
        id,
        nr_nota_pedidovenda,
        cliente_nome,
        prioridade,
        cidade,
        uf,
        peso_bruto,
        volumes,
        dt_faturamento_pedidovenda
      FROM vw_pedidos_despacho_completo 
      WHERE id = $1
    `;

    const pedidoResult = await client.query(pedidoQuery, [pedidovendaid]);

    if (pedidoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "Pedido não encontrado",
        detalhes: `Pedido ${pedidovendaid} não encontrado na view vw_pedidos_despacho_completo`,
      });
    }

    const pedido = pedidoResult.rows[0];
    const numeroPedido = pedido.nr_nota_pedidovenda;
    console.log(
      `📦 Pedido encontrado: ${pedido.nr_nota_pedidovenda} - ${pedido.cliente_nome}`,
    );

    // 1.5. LIMPAR BLOQUEIOS ANTIGOS (STALE) - Evita bloqueio fantasma
    const limparBloqueiosQuery = `
      UPDATE separacao_itens si
      SET bloqueado_por = NULL, data_bloqueio = NULL
      FROM separacao_pedidos sp
      WHERE si.id_separacao_pedido = sp.id
        AND sp.nr_nota_fiscal = $1
        AND (
          -- Bloqueio com data anterior a 20 minutos
          si.data_bloqueio < NOW() - INTERVAL '20 minutes'
          OR
          -- Ou bloqueio sem data (corrupto)
          (si.bloqueado_por IS NOT NULL AND si.data_bloqueio IS NULL)
        )
      RETURNING si.pedidovendaitemid;
    `;

    const limparResult = await client.query(limparBloqueiosQuery, [numeroPedido]);
    if (limparResult.rows.length > 0) {
      console.log(`🧹 ${limparResult.rows.length} bloqueios stale liberados para nova separação`);
    }

    // 2. Verificar se já existe em separacao_pedidos
    const existeQuery = await client.query(
      "SELECT * FROM separacao_pedidos WHERE nr_nota_fiscal = $1 ORDER BY id ASC LIMIT 1",
      [numeroPedido],
    );

    let pedidoSeparacao;

    if (existeQuery.rows.length === 0) {
      // Criar novo registro
      const criarQuery = `
        INSERT INTO separacao_pedidos (
          pedidovendaid,
          nr_nota_fiscal,
          cliente_nome,
          status,
          id_operador,
          data_inicio_separacao,
          observacoes,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, 'EM_SEPARACAO', $4, NOW(), 'Separação iniciada', NOW(), NOW())
        RETURNING *
      `;

      const criarResult = await client.query(criarQuery, [
        pedidovendaid,
        pedido.nr_nota_pedidovenda,
        pedido.cliente_nome,
        id_operador,
      ]);

      pedidoSeparacao = criarResult.rows[0];
      console.log(`📝 Novo registro criado: ID ${pedidoSeparacao.id}`);
    } else {
      // Atualizar registro existente
      const atualizarQuery = `
        UPDATE separacao_pedidos 
        SET 
          status = 'EM_SEPARACAO',
          id_operador = $2,
          data_inicio_separacao = NOW(),
          data_fim_separacao = NULL,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const atualizarResult = await client.query(atualizarQuery, [
        existeQuery.rows[0].id,
        id_operador,
      ]);

      pedidoSeparacao = atualizarResult.rows[0];
      console.log(`✏️ Registro atualizado: ID ${pedidoSeparacao.id}`);
    }

    const itensQuery = `
      SELECT 
        pi.pedidovendaitemid,
        pi.produtoid as produtoid_aworks,
        pi.ds_produto,
        pi.referencia,
        pi.quantidade_entrega,
        COALESCE(pi.quantidade_despachada, 0) as quantidade_despachada,
        GREATEST(pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0), 0) as quantidade_para_separar,
        p.id as produtoid
      FROM vw_pedido_itens_aworks_simples pi
      INNER JOIN vw_pedidos_despacho_completo vw ON vw.id = pi.pedidovendaid
      INNER JOIN produtos p ON p.id_cache = pi.produtoid  -- JOIN pelo id_cache
      WHERE vw.nr_nota_pedidovenda = $1
        AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
    `;

    const itensResult = await client.query(itensQuery, [numeroPedido]);

    if (itensResult.rows.length === 0) {
      console.log(
        "⚠️ Nenhum produto mapeado encontrado. Tentando criar automaticamente...",
      );

      // Buscar itens sem join primeiro
      const itensSemMapeamento = await client.query(
        `
        SELECT 
          pi.pedidovendaitemid,
          pi.produtoid as produtoid_aworks,
          pi.ds_produto,
          pi.referencia,
          pi.quantidade_entrega,
          COALESCE(pi.quantidade_despachada, 0) as quantidade_despachada,
          GREATEST(pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0), 0) as quantidade_para_separar
        FROM vw_pedido_itens_aworks_simples pi
        INNER JOIN vw_pedidos_despacho_completo vw ON vw.id = pi.pedidovendaid
        WHERE vw.nr_nota_pedidovenda = $1
          AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
      `,
        [numeroPedido],
      );

      // Criar produtos automaticamente (com tp_produto)
      for (const item of itensSemMapeamento.rows) {
        // Buscar tp_produto do AWORKSDB
        let tp_produto_aworks = null;
        try {
          const tpQuery = `SELECT tp_produto FROM produto WHERE produtoid = $1 AND empresaid = 1`;
          const tpResult = await poolSeven.query(tpQuery, [item.produtoid_aworks]);
          if (tpResult.rows.length > 0) {
            tp_produto_aworks = tpResult.rows[0].tp_produto;
          }
        } catch (err) {
          console.warn(`⚠️ Erro ao buscar tp_produto para produtoid ${item.produtoid_aworks}:`, err.message);
        }

        const criarProdutoQuery = `
          INSERT INTO produtos (referencia_produto, ds_produto, id_cache, tp_produto, updated_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (id_cache) DO UPDATE SET
            referencia_produto = EXCLUDED.referencia_produto,
            ds_produto = EXCLUDED.ds_produto,
            tp_produto = EXCLUDED.tp_produto,
            updated_at = NOW()
          RETURNING id
        `;

        const produtoResult = await client.query(criarProdutoQuery, [
          item.referencia || `REF-${item.produtoid_aworks}`,
          item.ds_produto || `Produto ${item.produtoid_aworks}`,
          item.produtoid_aworks,
          tp_produto_aworks, // Novo campo
        ]);

        // Adicionar ao array de itens
        itensResult.rows.push({
          ...item,
          produtoid_local: produtoResult.rows[0].id,
        });
      }
    }

    console.log(
      `🛒 ${itensResult.rows.length} itens encontrados para o pedido`,
    );

    // Criar itens na separacao_itens
    const itensCriados = [];
    for (const item of itensResult.rows) {
      const itemExiste = await client.query(
        "SELECT 1 FROM separacao_itens WHERE pedidovendaitemid = $1 AND id_separacao_pedido = $2",
        [item.pedidovendaitemid, pedidoSeparacao.id],
      );

      if (itemExiste.rows.length === 0) {
        const criarItemQuery = `
          INSERT INTO separacao_itens (
            id_separacao_pedido,
            pedidovendaitemid,
            id_produto,  -- Agora usando produtoid_local que é produtos.id
            quantidade_solicitada,
            quantidade_separada,
            quantidade_conferida,
            status,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, 0, 0, 'PENDENTE', NOW(), NOW())
          RETURNING id
        `;

        try {
          const itemCriado = await client.query(criarItemQuery, [
            pedidoSeparacao.id,
            item.pedidovendaitemid,
            item.produtoid_local,
            item.quantidade_para_separar,
          ]);

          itensCriados.push(itemCriado.rows[0]);
          console.log(
            `✅ Item criado: ${item.pedidovendaitemid} - Produto ID: ${item.produtoid_local}`,
          );
        } catch (insertError) {
          console.error(
            `❌ Erro ao criar item ${item.pedidovendaitemid}:`,
            insertError.message,
          );
          // Continua com os outros itens
        }
      }
    }

    // ============================================================
    // RESERVAR ESTOQUE AUTOMATICAMENTE
    // ============================================================
    let reservaInfo = null;
    try {
      const reservaQuery = `
        SELECT * FROM reservar_estoque_pedido($1, $2)
      `;
      const reservaResult = await client.query(reservaQuery, [
        pedidovendaid,
        id_operador
      ]);
      
      reservaInfo = reservaResult.rows[0];
      console.log(`📦 Reserva de estoque:`, reservaInfo);
    } catch (reservaError) {
      console.warn("⚠️ Erro ao reservar estoque (continua sem reserva):", reservaError.message);
      // Não falha a separação se a reserva falhar
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Separação iniciada com sucesso!",
      pedido: {
        ...pedidoSeparacao,
        total_itens: itensResult.rows.length,
        itens_criados: itensCriados.length,
      },
      reserva: reservaInfo
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao iniciar separação:", error);

    const hint =
      error?.code === "42703"
        ? "Erro de estrutura SQL: verifique nomes de colunas/tabelas usados na rota de iniciar separação"
        : "Produtos do pedido não estão mapeados na tabela produtos";

    res.status(500).json({
      error: "Erro ao iniciar separação",
      details: error.message,
      hint,
    });
  } finally {
    client.release();
  }
});

// ============================================================
// ROTAS DE RESERVA DE ESTOQUE
// ============================================================

// Buscar reservas ativas de um pedido
routerSeparacao.get("/reservas/pedido/:pedidoId", async (req, res) => {
  try {
    const { pedidoId } = req.params;
    
    const query = `
      SELECT * FROM vw_reservas_ativas 
      WHERE pedidovendaid = $1
      ORDER BY ordem_prioridade, data_reserva
    `;
    
    const result = await pool.query(query, [pedidoId]);
    
    res.json({
      success: true,
      reservas: result.rows
    });
  } catch (error) {
    console.error("❌ Erro ao buscar reservas:", error);
    res.status(500).json({
      error: "Erro ao buscar reservas",
      details: error.message
    });
  }
});

// Marcar reserva como utilizada
routerSeparacao.post("/reservas/:reservaId/utilizada", async (req, res) => {
  try {
    const { reservaId } = req.params;
    
    const query = `
      UPDATE reservas_estoque 
      SET 
        status = 'UTILIZADA',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [reservaId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Reserva não encontrada"
      });
    }
    
    res.json({
      success: true,
      message: "Reserva marcada como utilizada",
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Erro ao utilizar reserva:", error);
    res.status(500).json({
      error: "Erro ao utilizar reserva",
      details: error.message
    });
  }
});

// Cancelar reservas de um pedido
routerSeparacao.post("/reservas/pedido/:pedidoId/cancelar", async (req, res) => {
  try {
    const { pedidoId } = req.params;
    
    const query = `
      UPDATE reservas_estoque 
      SET 
        status = 'CANCELADA',
        observacoes = COALESCE(observacoes || ' | ', '') || 'Cancelado manualmente',
        updated_at = NOW()
      WHERE pedidovendaid = $1 
        AND status = 'ATIVA'
      RETURNING *
    `;
    
    const result = await pool.query(query, [pedidoId]);
    
    res.json({
      success: true,
      message: `${result.rows.length} reserva(s) cancelada(s)`,
      reservas_canceladas: result.rows.length
    });
  } catch (error) {
    console.error("❌ Erro ao cancelar reservas:", error);
    res.status(500).json({
      error: "Erro ao cancelar reservas",
      details: error.message
    });
  }
});

// Buscar estatísticas de reservas
routerSeparacao.get("/reservas/estatisticas", async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'ATIVA') as total_ativas,
        COUNT(*) FILTER (WHERE status = 'UTILIZADA') as total_utilizadas,
        COUNT(*) FILTER (WHERE status = 'CANCELADA') as total_canceladas,
        COUNT(*) as total_geral,
        COUNT(DISTINCT pedidovendaid) FILTER (WHERE status = 'ATIVA') as pedidos_com_reserva,
        SUM(quantidade_reservada) FILTER (WHERE status = 'ATIVA') as quantidade_total_reservada
      FROM reservas_estoque
      WHERE data_reserva >= CURRENT_DATE - INTERVAL '30 days'
    `;
    
    const result = await pool.query(query);
    
    res.json({
      success: true,
      estatisticas: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Erro ao buscar estatísticas:", error);
    res.status(500).json({
      error: "Erro ao buscar estatísticas",
      details: error.message
    });
  }
});

// Buscar prioridade de um pedido
routerSeparacao.get("/pedidos/:pedidoId/prioridade", async (req, res) => {
  try {
    const { pedidoId } = req.params;
    
    const query = `
      WITH pedido_ref AS (
        SELECT nr_nota_pedidovenda
        FROM vw_pedidos_despacho_completo
        WHERE id = $1
        LIMIT 1
      )
      SELECT 
        calcular_prioridade_pedido($1) as prioridade,
        sp.data_prioridade_separacao,
        (sp.data_prioridade_separacao::DATE - CURRENT_DATE) as dias_restantes
      FROM separacao_pedidos sp
      WHERE sp.nr_nota_fiscal = (SELECT nr_nota_pedidovenda FROM pedido_ref)
      ORDER BY sp.id ASC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [pedidoId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Pedido não encontrado"
      });
    }
    
    res.json({
      success: true,
      prioridade: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Erro ao buscar prioridade:", error);
    res.status(500).json({
      error: "Erro ao buscar prioridade",
      details: error.message
    });
  }
});

// Relatorio de separacoes com filtros operacionais
routerSeparacao.get("/relatorio/separacoes", async (req, res) => {
  try {
    const {
      produto,
      operador,
      cliente,
      status,
      data_inicio,
      data_fim,
      quantidade_min,
      quantidade_max,
      nota_fiscal
    } = req.query;

    const filtros = [];
    const params = [];
    let idx = 1;

    if (produto) {
      params.push(`%${String(produto).trim()}%`);
      filtros.push(`(
        COALESCE(pi.ds_produto, '') ILIKE $${idx}
        OR COALESCE(pi.referencia, '') ILIKE $${idx}
      )`);
      idx += 1;
    }

    if (operador) {
      params.push(`%${String(operador).trim()}%`);
      filtros.push(`(
        COALESCE(o.nome, '') ILIKE $${idx}
        OR COALESCE(od.operadores_detalhe, '') ILIKE $${idx}
      )`);
      idx += 1;
    }

    if (cliente) {
      params.push(`%${String(cliente).trim()}%`);
      filtros.push(`COALESCE(sp.cliente_nome, '') ILIKE $${idx}`);
      idx += 1;
    }

    if (status) {
      params.push(String(status).trim());
      filtros.push(`COALESCE(si.status, 'PENDENTE') = $${idx}`);
      idx += 1;
    }

    if (data_inicio) {
      params.push(String(data_inicio).trim());
      filtros.push(`si.data_separacao::date >= $${idx}::date`);
      idx += 1;
    }

    if (data_fim) {
      params.push(String(data_fim).trim());
      filtros.push(`si.data_separacao::date <= $${idx}::date`);
      idx += 1;
    }

    if (quantidade_min !== undefined && quantidade_min !== null && quantidade_min !== '') {
      params.push(Number(quantidade_min));
      filtros.push(`COALESCE(si.quantidade_separada, 0) >= $${idx}`);
      idx += 1;
    }

    if (quantidade_max !== undefined && quantidade_max !== null && quantidade_max !== '') {
      params.push(Number(quantidade_max));
      filtros.push(`COALESCE(si.quantidade_separada, 0) <= $${idx}`);
      idx += 1;
    }

    if (nota_fiscal) {
      params.push(`%${String(nota_fiscal).trim()}%`);
      filtros.push(`COALESCE(sp.nr_nota_fiscal, '') ILIKE $${idx}`);
      idx += 1;
    }

    const where = filtros.length > 0 ? `WHERE ${filtros.join(' AND ')}` : '';

    const query = `
      WITH separacoes_agrupadas AS (
        SELECT
          em.id_referencia AS separacao_item_id,
          em.id_operador,
          SUM(COALESCE(em.quantidade, 0))::numeric AS quantidade
        FROM estoque_movimentacoes em
        WHERE em.tipo_movimentacao = 'SEPARACAO'
          AND em.modulo_origem = 'SEPARACAO'
          AND em.referencia_movimento = 'SEPARACAO_ITEM'
          AND em.id_referencia IS NOT NULL
          AND em.id_operador IS NOT NULL
        GROUP BY em.id_referencia, em.id_operador
      ),
      operadores_detalhe AS (
        SELECT
          sa.separacao_item_id,
          STRING_AGG(
            CONCAT(COALESCE(o2.nome, CONCAT('Operador ', sa.id_operador::text)), ': ', TRIM(TO_CHAR(sa.quantidade, 'FM999999990.####'))),
            ' | '
            ORDER BY sa.quantidade DESC, o2.nome ASC NULLS LAST
          ) AS operadores_detalhe
        FROM separacoes_agrupadas sa
        LEFT JOIN operadores o2 ON o2.id = sa.id_operador
        GROUP BY sa.separacao_item_id
      )
      SELECT
        si.id,
        si.pedidovendaitemid,
        sp.pedidovendaid,
        sp.nr_nota_fiscal,
        sp.cliente_nome,
        COALESCE(pi.ds_produto, 'Produto sem descricao') AS produto_descricao,
        COALESCE(pi.referencia, '-') AS produto_referencia,
        COALESCE(si.status, 'PENDENTE') AS status,
        COALESCE(si.quantidade_solicitada, 0)::numeric AS quantidade_solicitada,
        COALESCE(si.quantidade_separada, 0)::numeric AS quantidade_separada,
        GREATEST(COALESCE(si.quantidade_solicitada, 0) - COALESCE(si.quantidade_separada, 0), 0)::numeric AS quantidade_pendente,
        COALESCE(o.nome, 'Nao identificado') AS operador_nome,
        COALESCE(od.operadores_detalhe, COALESCE(o.nome, 'Nao identificado')) AS operadores_detalhe,
        si.id_operador_separacao,
        si.data_separacao,
        si.updated_at,
        si.observacoes
      FROM separacao_itens si
      INNER JOIN separacao_pedidos sp ON sp.id = si.id_separacao_pedido
      LEFT JOIN vw_pedido_itens_aworks_simples pi ON pi.pedidovendaitemid = si.pedidovendaitemid
      LEFT JOIN operadores o ON o.id = si.id_operador_separacao
      LEFT JOIN operadores_detalhe od ON od.separacao_item_id = si.id
      ${where}
      ORDER BY COALESCE(si.data_separacao, si.updated_at, si.created_at) DESC, si.id DESC
      LIMIT 3000
    `;

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ Erro ao gerar relatório de separações:', error);
    res.status(500).json({
      erro: 'Erro ao gerar relatório de separações',
      detalhes: error.message
    });
  }
});

// 2. ITENS DO PEDIDO
routerSeparacao.get("/pedidos/:pedidoId/itens", async (req, res) => {
  const { pedidoId } = req.params;

  console.log("🔍 Buscando itens do pedido:", pedidoId);

  try {
    const limparBloqueiosStaleQuery = `
      UPDATE separacao_itens si
      SET bloqueado_por = NULL,
          data_bloqueio = NULL,
          updated_at = NOW()
      FROM separacao_pedidos sp
      INNER JOIN vw_pedidos_despacho_completo vw
        ON COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(vw.nr_nota_pedidovenda::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0')
         = COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0')
      WHERE si.id_separacao_pedido = sp.id
        AND vw.id = $1
        AND (
          si.data_bloqueio < NOW() - INTERVAL '20 minutes'
          OR (si.bloqueado_por IS NOT NULL AND si.data_bloqueio IS NULL)
        )
      RETURNING si.pedidovendaitemid;
    `;

    const bloqueiosStale = await pool.query(limparBloqueiosStaleQuery, [pedidoId]);
    if (bloqueiosStale.rows.length > 0) {
      console.log(`🧹 ${bloqueiosStale.rows.length} bloqueio(s) expirado(s) liberado(s) ao carregar itens do pedido ${pedidoId}`);
    }

    // Buscar itens da view diretamente, sem separacao_itens que pode estar vazia
    const queryItens = `
      WITH pedido_ref AS (
        SELECT
          nr_nota_pedidovenda,
          COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(nr_nota_pedidovenda::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') AS nr_nota_normalizada
        FROM vw_pedidos_despacho_completo
        WHERE id = $1
        LIMIT 1
      ),
      separacao_pedidos_nota AS (
        SELECT sp.id AS separacao_pedido_id
        FROM separacao_pedidos sp
        INNER JOIN pedido_ref pr
          ON COALESCE(NULLIF(LTRIM(REGEXP_REPLACE(COALESCE(sp.nr_nota_fiscal::text, ''), '[^0-9]', '', 'g'), '0'), ''), '0') = pr.nr_nota_normalizada
      ),
      separacao_item_totais AS (
        SELECT
          si.pedidovendaitemid,
          SUM(COALESCE(si.quantidade_separada, 0)) AS quantidade_separada,
          SUM(COALESCE(si.quantidade_conferida, 0)) AS quantidade_conferida
        FROM separacao_itens si
        INNER JOIN separacao_pedidos_nota spn ON spn.separacao_pedido_id = si.id_separacao_pedido
        GROUP BY si.pedidovendaitemid
      ),
      separacao_item_ativo AS (
        SELECT DISTINCT ON (si.pedidovendaitemid)
          si.pedidovendaitemid,
          si.status,
          si.bloqueado_por,
          si.data_bloqueio
        FROM separacao_itens si
        INNER JOIN separacao_pedidos_nota spn ON spn.separacao_pedido_id = si.id_separacao_pedido
        ORDER BY si.pedidovendaitemid,
                 CASE WHEN si.bloqueado_por IS NOT NULL THEN 0 ELSE 1 END,
                 si.updated_at DESC NULLS LAST,
                 si.id DESC
      )
      SELECT DISTINCT
        pi.pedidovendaitemid,
        pi.pedidovendaid,
        pi.produtoid as produtoid_original,
        pi.ds_produto as produto_descricao,
        pi.referencia as produto_referencia,
        pi.quantidade_entrega as quantidade_solicitada,
        COALESCE(pi.quantidade_despachada, 0) as quantidade_despachada,
        GREATEST(pi.quantidade_entrega - COALESCE(sit.quantidade_separada, 0), 0) as quantidade_pendente,
        
        -- Dados da separação se existir
        COALESCE(sit.quantidade_separada, 0) as quantidade_separada,
        COALESCE(sit.quantidade_conferida, 0) as quantidade_conferida,
        CASE
          WHEN COALESCE(sit.quantidade_separada, 0) >= pi.quantidade_entrega THEN 'FINALIZADO'
          ELSE COALESCE(sia.status, 'PENDENTE')
        END as status_item,
        
        -- Mapeamento do produto
        p.id as produtoid_local,
        COALESCE(p.id_cache, pi.produtoid) as id_cache,
        (p.id IS NOT NULL) as produto_mapeado,
        
        -- Dados de bloqueio para compartilhamento entre operadores
        sia.bloqueado_por,
        o.nome as nome_operador_bloqueio,
        sia.data_bloqueio
      
      FROM vw_pedido_itens_aworks_simples pi
      LEFT JOIN produtos p ON p.id_cache = pi.produtoid
      LEFT JOIN separacao_item_totais sit ON sit.pedidovendaitemid = pi.pedidovendaitemid
      LEFT JOIN separacao_item_ativo sia ON sia.pedidovendaitemid = pi.pedidovendaitemid
      LEFT JOIN operadores o ON sia.bloqueado_por = o.id
      INNER JOIN vw_pedidos_despacho_completo vw_pedido ON vw_pedido.id = pi.pedidovendaid
      INNER JOIN pedido_ref pr ON true
      
      WHERE vw_pedido.nr_nota_pedidovenda = pr.nr_nota_pedidovenda
        AND COALESCE(pi.quantidade_despachada, 0) < pi.quantidade_entrega
      
      ORDER BY pi.ds_produto;
    `;

    const resultItens = await pool.query(queryItens, [pedidoId]);

    if (resultItens.rows.length === 0) {
      console.log("⚠️ Nenhum item encontrado para o pedido");
      return res.json([]);
    }

    console.log(`📦 Encontrados ${resultItens.rows.length} itens`);

    // Para cada item, buscar endereços disponíveis
    const itensComEnderecos = await Promise.all(
      resultItens.rows.map(async (item) => {
        let enderecos = [];

        // Adicionando logs para depuração
        console.log(`🔍 Verificando id_cache: ${item.id_cache}, produtoid_original: ${item.produtoid_original}`);
        console.log(`🔍 Verificando produtoid_local: ${item.produtoid_local}`);

        // Buscar endereços se o produto está mapeado
        if (item.id_cache) {
          console.log(
            `🔍 Buscando endereços para produto id_cache=${item.id_cache}`,
          );

          const queryEnderecos = `
            SELECT
              ce.id_posicao,
              SUM(ce.quantidade_pacotes)::numeric AS quantidade_disponivel,
              p.codigo AS posicao_codigo,
              p.descricao AS posicao_descricao,
              n.codigo AS nivel_codigo,
              n.descricao AS nivel_descricao,
              m.codigo AS modulo_codigo,
              m.descricao AS modulo_descricao,
              r.codigo AS rua_codigo,
              r.descricao AS rua_descricao,
              le.codigo AS local_estoque,
              le.descricao AS local_estoque_descricao,
              STRING_AGG(DISTINCT NULLIF(ce.lote, ''), ', ') AS lote,
              STRING_AGG(DISTINCT NULLIF(ce.observacao, ''), ' | ') AS observacao,
              MAX(ce.data_contagem) AS data_contagem,
              CONCAT(COALESCE(r.codigo, 'CH'), '-', COALESCE(m.codigo, 'CH'), '-', COALESCE(n.codigo, 'CH'), '-', p.codigo) AS codigo_endereco,
              CONCAT(
                'Rua ', COALESCE(r.codigo, 'CH'), 
                CASE WHEN r.descricao IS NOT NULL THEN CONCAT(' (', r.descricao, ')') ELSE '' END,
                ', Módulo ', COALESCE(m.codigo, 'CH'),
                CASE WHEN m.descricao IS NOT NULL THEN CONCAT(' (', m.descricao, ')') ELSE '' END,
                ', Nível ', COALESCE(n.codigo, 'CH'),
                CASE WHEN n.descricao IS NOT NULL THEN CONCAT(' (', n.descricao, ')') ELSE '' END,
                ', Posição ', p.codigo,
                CASE WHEN p.descricao IS NOT NULL THEN CONCAT(' (', p.descricao, ')') ELSE '' END
              ) AS descricao_completa,
              CONCAT(
                'Rua: ', COALESCE(r.codigo, 'CH'), ' | Módulo: ', COALESCE(m.codigo, 'CH'), 
                ' | Nível: ', COALESCE(n.codigo, 'CH'), ' | Posição: ', p.codigo
              ) AS localizacao_legivel
            FROM contagem_estoque ce
            INNER JOIN posicoes p ON ce.id_posicao = p.id
            LEFT JOIN niveis n ON p.id_nivel = n.id
            LEFT JOIN modulos m ON n.id_modulo = m.id
            LEFT JOIN ruas r ON m.id_rua = r.id
            INNER JOIN locais_estoque le ON p.id_local_estoque = le.id
            WHERE ce.id_produto = $1
              AND ce.quantidade_pacotes > 0
              -- Preferir o último inventário 'fechado', mas se não houver,
              -- usar o último inventário disponível (fallback).
              AND ce.id_inventario = COALESCE(
                (
                  SELECT id FROM inventario 
                  WHERE status = 'fechado' 
                  ORDER BY id DESC 
                  LIMIT 1
                ),
                (
                  SELECT id FROM inventario 
                  ORDER BY id DESC 
                  LIMIT 1
                )
              )
            GROUP BY
              ce.id_posicao,
              p.codigo,
              p.descricao,
              n.codigo,
              n.descricao,
              m.codigo,
              m.descricao,
              r.codigo,
              r.descricao,
              le.codigo,
              le.descricao
            ORDER BY COALESCE(r.codigo, ''), COALESCE(m.codigo, ''), COALESCE(n.codigo, ''), p.codigo;
          `;

          // Note: contagem_estoque.id_produto armazena o `id_cache` do produto.
          // Devemos passar `item.id_cache` para a consulta, não o `produtoid_original`.
          const resultEnderecos = await pool.query(queryEnderecos, [item.id_cache]);
          enderecos = resultEnderecos.rows;

          console.log(
            `✅ Item ${item.pedidovendaitemid}: ${enderecos.length} endereços encontrados`,
          );
          if (enderecos.length === 0) {
            console.log(`⚠️ Sem endereços para id_cache: ${item.id_cache}`);
          }
        } else {
          console.log(
            `⚠️ Item ${item.pedidovendaitemid} não mapeado (id_cache: ${item.id_cache})`,
          );
        }

        const quantidade_pendente = parseFloat(item.quantidade_pendente || 0);
        const estoque_total = enderecos.reduce(
          (sum, e) => sum + parseFloat(e.quantidade_disponivel || 0),
          0,
        );

        return {
          pedidovendaitemid: item.pedidovendaitemid,
          pedidovendaid: item.pedidovendaid,
          produtoid_original: item.produtoid_original,
          produtoid_local: item.produtoid_local || 0,
          produto_descricao: item.produto_descricao,
          produto_referencia: item.produto_referencia,
          quantidade_solicitada: parseFloat(item.quantidade_solicitada) || 0,
          quantidade_pendente: quantidade_pendente,
          quantidade_separada: parseFloat(item.quantidade_separada || 0),
          quantidade_conferida: parseFloat(item.quantidade_conferida || 0),
          status_item: item.status_item || "PENDENTE",
          produto_mapeado: item.produto_mapeado || false,
          estoque_total: estoque_total,
          id_cache: item.id_cache || null,
          enderecos_disponiveis: enderecos.map((e) => ({
            id_posicao: e.id_posicao,
            codigo_endereco: e.codigo_endereco,
            descricao_completa: e.descricao_completa,
            quantidade_disponivel: parseFloat(e.quantidade_disponivel) || 0,
            local_estoque: e.local_estoque,
            local_estoque_descricao: e.local_estoque_descricao,
            rua_codigo: e.rua_codigo,
            rua_descricao: e.rua_descricao,
            modulo_codigo: e.modulo_codigo,
            modulo_descricao: e.modulo_descricao,
            nivel_codigo: e.nivel_codigo,
            nivel_descricao: e.nivel_descricao,
            posicao_codigo: e.posicao_codigo,
            posicao_descricao: e.posicao_descricao,
            lote: e.lote,
            observacao: e.observacao,
            localizacao_legivel: e.localizacao_legivel,
            data_contagem: e.data_contagem,
            id_inventario: null,
          })),
        };
      }),
    );

    res.json(itensComEnderecos);
  } catch (error) {
    console.error("❌ Erro ao buscar itens com endereços:", error);
    console.error("Stack:", error.stack);
    registrarErro("Erro ao buscar itens de separação", error);
    res.status(500).json({
      erro: "Erro ao buscar itens",
      detalhes: error.message,
      sql: error.query || "N/A",
    });
  }
});

// Rota específica para buscar endereços de um produto
app.get(
  "/api/separacao/produto/:id_cache/enderecos",
  autenticarToken,
  async (req, res) => {
    const { id_cache } = req.params;

    console.log("🔍 Buscando endereços para id_cache:", id_cache);

    try {
      const query = `
      SELECT
        -- IDs
        ce.id_posicao,
        MAX(ce.id_inventario) AS id_inventario,
        
        -- Quantidades consolidadas por posição
        SUM(ce.quantidade_pacotes)::numeric AS quantidade_disponivel,
        
        -- Posição
        p.id AS posicao_id,
        p.codigo AS posicao_codigo,
        p.descricao AS posicao_descricao,
        p.capacidade AS posicao_capacidade,
        
        -- Nível
        n.id AS nivel_id,
        n.codigo AS nivel_codigo,
        n.descricao AS nivel_descricao,
        
        -- Módulo
        m.id AS modulo_id,
        m.codigo AS modulo_codigo,
        m.descricao AS modulo_descricao,
        
        -- Rua
        r.id AS rua_id,
        r.codigo AS rua_codigo,
        r.descricao AS rua_descricao,
        
        -- Local de Estoque
        le.id AS local_estoque_id,
        le.codigo AS local_estoque,
        le.descricao AS local_estoque_descricao,
        
        -- Outras informações consolidadas
        STRING_AGG(DISTINCT NULLIF(ce.lote, ''), ', ') AS lote,
        STRING_AGG(DISTINCT NULLIF(ce.observacao, ''), ' | ') AS observacao,
        MAX(ce.data_contagem) AS data_contagem,
        
        -- Código do endereço formatado
        CONCAT(COALESCE(r.codigo, 'CH'), '-', COALESCE(m.codigo, 'CH'), '-', COALESCE(n.codigo, 'CH'), '-', p.codigo) AS codigo_endereco,
        
        -- Descrição completa
        CONCAT(
          'Rua ', COALESCE(r.codigo, 'CH'), 
          CASE WHEN r.descricao IS NOT NULL THEN CONCAT(' (', r.descricao, ')') ELSE '' END,
          ', Módulo ', COALESCE(m.codigo, 'CH'),
          CASE WHEN m.descricao IS NOT NULL THEN CONCAT(' (', m.descricao, ')') ELSE '' END,
          ', Nível ', COALESCE(n.codigo, 'CH'),
          CASE WHEN n.descricao IS NOT NULL THEN CONCAT(' (', n.descricao, ')') ELSE '' END,
          ', Posição ', p.codigo,
          CASE WHEN p.descricao IS NOT NULL THEN CONCAT(' (', p.descricao, ')') ELSE '' END
        ) AS descricao_completa,
        
        -- Localização legível
        CONCAT(
          'Rua: ', COALESCE(r.codigo, 'CH'),
          ' | Módulo: ', COALESCE(m.codigo, 'CH'),
          ' | Nível: ', COALESCE(n.codigo, 'CH'),
          ' | Posição: ', p.codigo
        ) AS localizacao_legivel
        
      FROM contagem_estoque ce
      INNER JOIN posicoes p ON ce.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      INNER JOIN locais_estoque le ON p.id_local_estoque = le.id
      
      WHERE ce.id_produto = $1
        AND ce.quantidade_pacotes > 0
        -- Preferir o último inventário 'fechado', mas, se não existir,
        -- usar o último inventário disponível (fallback).
        AND ce.id_inventario = COALESCE(
          (
            SELECT id FROM inventario 
            WHERE status = 'fechado' 
            ORDER BY id DESC 
            LIMIT 1
          ),
          (
            SELECT id FROM inventario 
            ORDER BY id DESC 
            LIMIT 1
          )
        )
      GROUP BY
        ce.id_posicao,
        p.id,
        p.codigo,
        p.descricao,
        p.capacidade,
        n.id,
        n.codigo,
        n.descricao,
        m.id,
        m.codigo,
        m.descricao,
        r.id,
        r.codigo,
        r.descricao,
        le.id,
        le.codigo,
        le.descricao
      ORDER BY 
        COALESCE(r.codigo, ''), 
        COALESCE(m.codigo, ''), 
        COALESCE(n.codigo, ''), 
        p.codigo;
    `;

      const result = await pool.query(query, [id_cache]);

      console.log(
        `✅ Encontrados ${result.rows.length} endereços para id_cache ${id_cache}`,
      );

      if (result.rows.length > 0) {
        console.log("📋 Exemplo de endereço:", result.rows[0]);
      }

      // Formatar os dados para garantir tipos corretos
      const enderecosFormatados = result.rows.map((end) => ({
        id_posicao: end.id_posicao,
        codigo_endereco: end.codigo_endereco,
        descricao_completa: end.descricao_completa,
        quantidade_disponivel: parseFloat(end.quantidade_disponivel) || 0,
        local_estoque: end.local_estoque,

        // Estrutura hierárquica
        rua_codigo: end.rua_codigo,
        rua_descricao: end.rua_descricao,
        modulo_codigo: end.modulo_codigo,
        modulo_descricao: end.modulo_descricao,
        nivel_codigo: end.nivel_codigo,
        nivel_descricao: end.nivel_descricao,
        posicao_codigo: end.posicao_codigo,
        posicao_descricao: end.posicao_descricao,
        local_estoque_descricao: end.local_estoque_descricao,

        // Outras informações
        lote: end.lote,
        observacao: end.observacao,
        localizacao_legivel: end.localizacao_legivel,
        data_contagem: end.data_contagem,
        id_inventario: end.id_inventario,
      }));

      res.json(enderecosFormatados);
    } catch (error) {
      console.error("❌ Erro ao buscar endereços:", error);
      registrarErro("Erro ao buscar endereços para separação", error);
      res.status(500).json({
        erro: "Erro ao buscar endereços",
        detalhes: error.message,
      });
    }
  },
);

// 3. REGISTRAR SEPARAÇÃO DE ITEM
routerSeparacao.post("/itens/separar", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      pedidovendaitemid,
      id_posicao,
      quantidade_separada,
      id_operador,
      observacao,
    } = req.body;

    await liberarBloqueioInativo(client, pedidovendaitemid);

    const lockResult = await client.query(
      `SELECT si.id,
              si.bloqueado_por,
              o.nome AS nome_operador_bloqueio
       FROM public.separacao_itens si
       LEFT JOIN public.operadores o ON o.id = si.bloqueado_por
       WHERE si.pedidovendaitemid = $1
       ORDER BY CASE WHEN si.bloqueado_por IS NOT NULL THEN 0 ELSE 1 END,
                si.data_bloqueio DESC NULLS LAST,
                si.updated_at DESC NULLS LAST,
                si.id DESC
       LIMIT 1
       FOR UPDATE OF si`,
      [pedidovendaitemid]
    );

    const lockInfo = lockResult.rows[0] || null;
    const operadorAtualNumerico = Number(id_operador);
    const bloqueadoPor = Number(lockInfo?.bloqueado_por);
    const itemSeparacaoExistenteId = Number(lockInfo?.id);

    if (Number.isFinite(bloqueadoPor) && bloqueadoPor > 0 && bloqueadoPor !== operadorAtualNumerico) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: `Este item está bloqueado por ${lockInfo?.nome_operador_bloqueio || 'outro operador'}`,
        bloqueado_por: bloqueadoPor,
        nome_operador: lockInfo?.nome_operador_bloqueio || null,
      });
    }

    if (Number.isFinite(itemSeparacaoExistenteId) && (!Number.isFinite(bloqueadoPor) || bloqueadoPor <= 0)) {
      await client.query(
        `UPDATE public.separacao_itens
         SET bloqueado_por = $2,
             data_bloqueio = NOW(),
             quantidade_separada_inicial = COALESCE(quantidade_separada, 0),
             updated_at = NOW()
         WHERE id = $1`,
        [itemSeparacaoExistenteId, operadorAtualNumerico]
      );
    } else if (Number.isFinite(itemSeparacaoExistenteId)) {
      await client.query(
        `UPDATE public.separacao_itens
         SET data_bloqueio = NOW(),
             updated_at = NOW()
         WHERE id = $1
           AND bloqueado_por = $2`,
        [itemSeparacaoExistenteId, operadorAtualNumerico]
      );
    }

    console.log(`📝 Registrando separação:`, req.body);

    // 1. Buscar informações do item e da separação
    const infoQuery = `
      SELECT 
        pi.pedidovendaid,
        pi.produtoid AS produtoid_cache,
        p.id AS produtoid_local,
        pi.ds_produto,
        pi.referencia,
        GREATEST(pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0), 0) AS quantidade_para_separar,
        sp.id as separacao_pedido_id
      FROM vw_pedido_itens_aworks_simples pi
      LEFT JOIN produtos p ON p.id_cache = pi.produtoid
      INNER JOIN LATERAL (
        SELECT sp2.id
        FROM separacao_pedidos sp2
        WHERE sp2.pedidovendaid = pi.pedidovendaid
        ORDER BY sp2.updated_at DESC NULLS LAST, sp2.id DESC
        LIMIT 1
      ) sp ON true
      WHERE pi.pedidovendaitemid = $1
      LIMIT 1
    `;

    const infoResult = await client.query(infoQuery, [pedidovendaitemid]);

    if (infoResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item não encontrado" });
    }

    const info = infoResult.rows[0];
    const separacaoPedidoId = Number(info.separacao_pedido_id);
    const quantidadeParaSeparar = parseFloat(info.quantidade_para_separar || 0);
    const pedidovendaitemidNumerico = Number(pedidovendaitemid);
    const idPosicaoNumerico = Number(id_posicao);
    const quantidadeSeparadaInformada = Number(quantidade_separada);
    const produtoIdLocalNumerico = Number(info.produtoid_local);
    const operadorIdNumerico = Number(id_operador);

    if (quantidadeParaSeparar <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Item já foi totalmente despachado e não possui saldo para separação",
        pedidovendaitemid,
      });
    }

    // separacao_itens.id_produto referencia produtos.id (não o id_cache/original do AWORKS)
    if (!produtoIdLocalNumerico) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "Produto não mapeado na tabela produtos. Verifique o vínculo por id_cache antes de separar.",
        pedidovendaitemid,
        produtoid_cache: info.produtoid_cache,
      });
    }

    // 2. Verificar se o item já existe em separacao_itens
    const verificarItemQuery = `
      SELECT * FROM separacao_itens 
      WHERE pedidovendaitemid = $1 
        AND id_separacao_pedido = $2
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
      FOR UPDATE
    `;

    const itemExiste = await client.query(verificarItemQuery, [
      pedidovendaitemid,
      separacaoPedidoId,
    ]);

    let itemSeparacaoId;
    let novaQuantidadeSeparada;

    if (itemExiste.rows.length === 0) {
      // Criar novo registro
      const criarItemQuery = `
        INSERT INTO separacao_itens (
          id_separacao_pedido,
          pedidovendaitemid,
          id_produto,
          id_posicao,
          quantidade_solicitada,
          quantidade_separada,
          quantidade_conferida,
          status,
          id_operador_separacao,
          data_separacao,
          observacoes,
          created_at,
          updated_at
        ) VALUES (
          $1::integer,
          $2::integer,
          $3::integer,
          $4::integer,
          $5::numeric,
          $6::numeric,
          0,
          CASE WHEN $6::numeric >= $5::numeric THEN 'FINALIZADO' ELSE 'SEPARANDO' END,
          $7::integer,
          NOW(),
          $8::text,
          NOW(),
          NOW()
        )
        RETURNING id, quantidade_separada
      `;

      const criarResult = await client.query(criarItemQuery, [
        separacaoPedidoId,
        pedidovendaitemidNumerico,
        produtoIdLocalNumerico,
        idPosicaoNumerico,
        quantidadeParaSeparar,
        quantidadeSeparadaInformada,
        operadorIdNumerico,
        observacao || `Separado pelo operador ${id_operador}`,
      ]);

      itemSeparacaoId = criarResult.rows[0].id;
      novaQuantidadeSeparada = criarResult.rows[0].quantidade_separada;
    } else {
      // Atualizar registro existente
      const itemAtual = itemExiste.rows[0];
      novaQuantidadeSeparada =
        parseFloat(itemAtual.quantidade_separada || 0) +
        parseFloat(quantidade_separada);

      const atualizarItemQuery = `
        UPDATE separacao_itens 
        SET 
          id_produto = COALESCE(id_produto, $8::integer),
          id_posicao = COALESCE($1::integer, id_posicao),
          quantidade_solicitada = COALESCE(quantidade_solicitada, $7::numeric),
          quantidade_separada = $2::numeric,
          status = CASE 
            WHEN $2::numeric >= COALESCE(quantidade_solicitada, $7::numeric) THEN 'FINALIZADO' 
            ELSE 'SEPARANDO' 
          END,
          id_operador_separacao = $3::integer,
          data_separacao = NOW(),
          observacoes = COALESCE(observacoes, '') || ' | ' || $4::text,
          updated_at = NOW()
        WHERE pedidovendaitemid = $5::integer 
          AND id = $6::integer
        RETURNING id, quantidade_separada
      `;

      const atualizarResult = await client.query(atualizarItemQuery, [
        idPosicaoNumerico,
        novaQuantidadeSeparada,
        operadorIdNumerico,
        observacao ||
          `Adicionado ${quantidade_separada} pelo operador ${id_operador}`,
        pedidovendaitemidNumerico,
        itemAtual.id,
        quantidadeParaSeparar,
        produtoIdLocalNumerico,
      ]);

      itemSeparacaoId = atualizarResult.rows[0].id;
    }

    // 3. NOVO: Reduzir inventário imediatamente na separação
    const quantidadeSeparadaNum = Number(quantidade_separada) || 0;
    console.log(
      `📦 Reduzindo inventário: posição ${id_posicao}, produto cache ${info.produtoid_cache}, quantidade ${quantidadeSeparadaNum}`
    );

    const reduzirEstoqueQuery = `
      WITH inventario_alvo AS (
        SELECT COALESCE(
          (
            SELECT id FROM inventario
            WHERE status = 'fechado'
            ORDER BY id DESC
            LIMIT 1
          ),
          (
            SELECT id FROM inventario
            ORDER BY id DESC
            LIMIT 1
          )
        ) AS id
      ),
      linhas AS (
        SELECT
          ce.id,
          ce.quantidade_pacotes,
          COALESCE(
            SUM(ce.quantidade_pacotes) OVER (
              ORDER BY COALESCE(ce.data_contagem, ce.data_hora), ce.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          ) AS acumulado_anterior
        FROM contagem_estoque ce
        WHERE ce.id_posicao = $2
          AND ce.id_produto = $3
          AND ce.id_inventario = (SELECT id FROM inventario_alvo)
          AND ce.quantidade_pacotes > 0
      ),
      consumo AS (
        SELECT
          l.id,
          LEAST(
            l.quantidade_pacotes,
            GREATEST(0, $1::numeric - l.acumulado_anterior)
          ) AS qtd_baixar
        FROM linhas l
        WHERE l.acumulado_anterior < $1::numeric
      ),
      atualizados AS (
        UPDATE contagem_estoque ce
        SET quantidade_pacotes = GREATEST(0, ce.quantidade_pacotes - c.qtd_baixar)
        FROM consumo c
        WHERE ce.id = c.id
          AND c.qtd_baixar > 0
        RETURNING ce.id, c.qtd_baixar, ce.quantidade_pacotes
      )
      SELECT
        COALESCE(SUM(qtd_baixar), 0)::numeric AS total_baixado,
        COUNT(*)::int AS linhas_atualizadas,
        COALESCE(
          (
            SELECT SUM(ce2.quantidade_pacotes)
            FROM contagem_estoque ce2
            WHERE ce2.id_posicao = $2
              AND ce2.id_produto = $3
              AND ce2.id_inventario = (SELECT id FROM inventario_alvo)
          ),
          0
        )::numeric AS estoque_apos_baixa
      FROM atualizados
    `;

    await definirContextoAuditoriaEstoque(client, {
      id_operador,
      origem_modulo: "SEPARACAO",
      origem_tipo: "SEPARACAO_ITEM",
      referencia_movimento: "SEPARACAO_ITEM",
      id_referencia: itemSeparacaoId,
      observacao: observacao || `Separação do pedido item ${pedidovendaitemid}`,
    });

    const reduzirResult = await client.query(reduzirEstoqueQuery, [
      quantidadeSeparadaNum,
      id_posicao,
      info.produtoid_cache,
    ]);

    const totalBaixado = Number(reduzirResult.rows?.[0]?.total_baixado || 0);
    const linhasAtualizadas = Number(reduzirResult.rows?.[0]?.linhas_atualizadas || 0);
    const estoqueAposBaixa = Number(reduzirResult.rows?.[0]?.estoque_apos_baixa || 0);

    if (totalBaixado < quantidadeSeparadaNum) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Estoque insuficiente para concluir a separação",
        details: `Solicitado ${quantidadeSeparadaNum}, baixado ${totalBaixado}`,
      });
    }

    if (totalBaixado > 0) {
      console.log(
        `  ✅ Estoque reduzido: -${totalBaixado} pacotes em ${linhasAtualizadas} linha(s) | Saldo remanescente: ${estoqueAposBaixa}`
      );

      await registrarMovimentacaoEstoque(client, {
        tipo_movimentacao: "SEPARACAO",
        id_produto: info.produtoid_cache,
        id_posicao_origem: id_posicao,
        id_posicao_destino: null,
        quantidade: totalBaixado,
        id_operador,
        modulo_origem: "SEPARACAO",
        referencia_movimento: "SEPARACAO_ITEM",
        id_referencia: itemSeparacaoId,
        observacao: observacao || `Separação do pedido item ${pedidovendaitemid}`,
      });
    } else {
      console.log(
        `  ⚠️ Aviso: Nenhum registro encontrado em contagem_estoque para posição ${id_posicao} e produto cache ${info.produtoid_cache}`
      );
    }

    // 4. Atualizar estatísticas do pedido
    const atualizarPedidoQuery = `
      UPDATE separacao_pedidos 
      SET 
        status = 'EM_SEPARACAO',
        updated_at = NOW()
      WHERE id = $1
    `;
    await client.query(atualizarPedidoQuery, [separacaoPedidoId]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Separação registrada com sucesso",
      item_id: itemSeparacaoId,
      pedido_id: info.pedidovendaid,
      quantidade_separada: novaQuantidadeSeparada,
      status:
        novaQuantidadeSeparada >= quantidadeParaSeparar
          ? "FINALIZADO"
          : "SEPARANDO",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao registrar separação:", error);
    res.status(500).json({
      error: "Erro ao registrar separação",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// 4. ENDEREÇOS DISPONÍVEIS PARA PRODUTO
routerSeparacao.get("/produtos/:id/enderecos", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        ce.id_posicao,
        MAX(ce.id_inventario) AS id_inventario,
        CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) as codigo_endereco,
        SUM(ce.quantidade_pacotes)::numeric as quantidade_disponivel,
        le.codigo as local_estoque,
        le.descricao as local_estoque_descricao,
        r.codigo as rua_codigo,
        r.descricao as rua_descricao,
        m.codigo as modulo_codigo,
        m.descricao as modulo_descricao,
        n.codigo as nivel_codigo,
        n.descricao as nivel_descricao,
        p.codigo as posicao_codigo,
        p.descricao as posicao_descricao,
        STRING_AGG(DISTINCT NULLIF(ce.lote, ''), ', ') AS lote,
        STRING_AGG(DISTINCT NULLIF(ce.observacao, ''), ' | ') AS observacao,
        MAX(ce.data_contagem) AS data_contagem,
        CONCAT(
          'Rua ', COALESCE(r.codigo, 'CH'), 
          CASE WHEN r.descricao IS NOT NULL THEN CONCAT(' (', r.descricao, ')') ELSE '' END,
          ', Módulo ', COALESCE(m.codigo, 'CH'),
          CASE WHEN m.descricao IS NOT NULL THEN CONCAT(' (', m.descricao, ')') ELSE '' END,
          ', Nível ', COALESCE(n.codigo, 'CH'),
          CASE WHEN n.descricao IS NOT NULL THEN CONCAT(' (', n.descricao, ')') ELSE '' END,
          ', Posição ', p.codigo,
          CASE WHEN p.descricao IS NOT NULL THEN CONCAT(' (', p.descricao, ')') ELSE '' END
        ) AS descricao_completa,
        CONCAT(
          'Rua: ', COALESCE(r.codigo, 'CH'),
          ' | Módulo: ', COALESCE(m.codigo, 'CH'),
          ' | Nível: ', COALESCE(n.codigo, 'CH'),
          ' | Posição: ', p.codigo
        ) AS localizacao_legivel
      FROM contagem_estoque ce
      JOIN posicoes p ON ce.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      JOIN locais_estoque le ON p.id_local_estoque = le.id
      WHERE (
          ce.id_produto = $1
          OR ce.id_produto = (
            SELECT pr.id_cache
            FROM produtos pr
            WHERE pr.id = $1
            LIMIT 1
          )
        )
        AND ce.quantidade_pacotes > 0
        AND ce.id_inventario = COALESCE(
          (
            SELECT id FROM inventario 
            WHERE status = 'fechado' 
            ORDER BY id DESC 
            LIMIT 1
          ),
          (
            SELECT id FROM inventario 
            ORDER BY id DESC 
            LIMIT 1
          )
        )
      GROUP BY
        ce.id_posicao,
        p.codigo,
        p.descricao,
        n.codigo,
        n.descricao,
        m.codigo,
        m.descricao,
        r.codigo,
        r.descricao,
        le.codigo,
        le.descricao
      ORDER BY COALESCE(r.codigo, ''), COALESCE(m.codigo, ''), COALESCE(n.codigo, ''), p.codigo
    `;

    const result = await pool.query(query, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar endereços do produto:", error);
    res
      .status(500)
      .json({ error: "Erro ao buscar endereços", details: error.message });
  }
});

// Rota para registrar conferência - CORRIGIDA
routerSeparacao.post("/itens/conferir", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { pedidovendaitemid, quantidade_conferida, id_operador } = req.body;

    console.log(`✅ Registrando conferência:`, req.body);

    const query = `
      UPDATE separacao_itens 
      SET 
        quantidade_conferida = COALESCE(quantidade_conferida, quantidade_separada),
        id_operador_conferencia = $1,
        data_conferencia = NOW(),
        updated_at = NOW()
      WHERE pedidovendaitemid = $2
      RETURNING *
    `;

    const result = await client.query(query, [id_operador, pedidovendaitemid]);

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Item não encontrado" });
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Conferência registrada com sucesso",
      item: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao registrar conferência:", error);
    res.status(500).json({
      error: "Erro ao registrar conferência",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// 5. VERIFICAR DISPONIBILIDADE DE ESTOQUE
routerSeparacao.get("/pedidos/:id/verificar-estoque", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 Verificando estoque para pedido ${id}`);

    // Buscar itens do pedido com mapeamento correto de IDs
    const itensQuery = `
      SELECT 
        pi.pedidovendaitemid,
        pi.produtoid as id_produto,
        pi.ds_produto,
        pi.referencia,
        pi.quantidade_entrega,
        COALESCE(pi.quantidade_despachada, 0) as quantidade_despachada,
        (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) as quantidade_pendente
      FROM vw_pedido_itens_aworks_simples pi
      WHERE pi.pedidovendaid = $1
        AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
      ORDER BY pi.ds_produto
    `;

    const itensResult = await pool.query(itensQuery, [id]);
    const itens = itensResult.rows;

    console.log(`📋 Encontrados ${itens.length} itens pendentes`);

    const itensFaltantes = [];
    const itensDisponiveis = [];
    let todosDisponiveis = true;

    for (const item of itens) {
      // Verificar estoque no inventário mais recente (preferencialmente aberto)
      const estoqueQuery = `
        SELECT 
          COALESCE(SUM(ce.quantidade_pacotes), 0) as estoque_total,
          inv.id as id_inventario,
          inv.status as status_inventario
        FROM contagem_estoque ce
        JOIN inventario inv ON inv.id = ce.id_inventario
        WHERE ce.id_produto = $1
        GROUP BY inv.id, inv.status
        ORDER BY 
          CASE inv.status WHEN 'aberto' THEN 0 ELSE 1 END,
          inv.id DESC
        LIMIT 1
      `;

      const estoqueResult = await pool.query(estoqueQuery, [item.id_produto]);
      const estoque = estoqueResult.rows[0] || { estoque_total: 0 };
      const estoqueTotal = Number(estoque.estoque_total) || 0;
      const quantidadePendente = Number(item.quantidade_pendente) || 0;

      if (estoqueTotal < quantidadePendente) {
        todosDisponiveis = false;
        const faltante = quantidadePendente - estoqueTotal;
        console.log(`⚠️ Item ${item.ds_produto}: Solicitado=${quantidadePendente}, Em estoque=${estoqueTotal}, Faltante=${faltante}`);
        
        itensFaltantes.push({
          pedidovendaitemid: item.pedidovendaitemid,
          id_cache: item.id_produto,
          referencia: item.referencia,
          descricao: item.ds_produto,
          quantidade_solicitada: quantidadePendente,
          quantidade_disponivel: estoqueTotal,
          faltante: faltante
        });
      } else {
        console.log(`✅ Item ${item.ds_produto}: OK (${estoqueTotal} unidades)`);
        itensDisponiveis.push({
          pedidovendaitemid: item.pedidovendaitemid,
          id_cache: item.id_produto,
          referencia: item.referencia,
          descricao: item.ds_produto,
          quantidade_solicitada: quantidadePendente,
          quantidade_disponivel: estoqueTotal,
          faltante: 0
        });
      }
    }

    console.log(`📋 Resultado: Disponível=${todosDisponiveis}, Faltantes=${itensFaltantes.length}`);

    res.json({
      disponivel: todosDisponiveis,
      itens_disponiveis: itensDisponiveis,
      itens_faltantes: itensFaltantes
    });
  } catch (error) {
    console.error("❌ Erro ao verificar estoque:", error);
    res
      .status(500)
      .json({ error: "Erro ao verificar estoque", details: error.message });
  }
});

// Reportar falta de produtos (acesso restrito - apenas operador 3)
routerSeparacao.post("/relatar-falta-estoque", async (req, res) => {
  try {
    const { pedidovendaid, itens_faltantes, observacao, id_operador } = req.body;

    console.log(`📄 Reportando falta de estoque para pedido ${pedidovendaid} - Operador: ${id_operador}`);

    if (!itens_faltantes || itens_faltantes.length === 0) {
      return res.status(400).json({
        error: 'Dados inválidos',
        message: 'Deve ter pelo menos um item faltante para reportar'
      });
    }

    // Criar registro de falta
    const inserirQuery = `
      INSERT INTO relatorios_falta_estoque (
        pedidovendaid,
        id_operador,
        dados_itens,
        observacao,
        data_relatorio,
        status
      ) VALUES ($1, $2, $3, $4, NOW(), 'ABERTO')
      RETURNING id, pedidovendaid, data_relatorio, status
    `;

    const result = await pool.query(
      inserirQuery,
      [
        pedidovendaid,
        id_operador,
        JSON.stringify(itens_faltantes),
        observacao || null
      ]
    );

    console.log(`✅ Relatório de falta criado - ID: ${result.rows[0].id}`);

    res.json({
      success: true,
      message: 'Falta de estoque reportada com sucesso',
      relatorio_id: result.rows[0].id,
      dados: result.rows[0]
    });

  } catch (error) {
    console.error("❌ Erro ao reportar falta:", error);
    res.status(500).json({
      error: 'Erro ao reportar falta de estoque',
      details: error.message
    });
  }
});

// Listar relatórios de falta de estoque
routerSeparacao.get("/relatorios-falta", async (req, res) => {
  console.log(`📋 GET /relatorios-falta - Query:`, req.query);
  try {
    const { status, limit = 50 } = req.query;

    let query = `
      SELECT 
        r.id,
        r.pedidovendaid,
        r.id_operador,
        r.dados_itens,
        r.observacao,
        r.data_relatorio,
        r.status,
        r.data_resolucao,
        r.id_operador_resolucao,
        r.observacao_resolucao,
        o.nome as nome_operador,
        o_res.nome as nome_operador_resolucao,
        p.nr_nota_pedidovenda,
        p.cliente_nome
      FROM relatorios_falta_estoque r
      LEFT JOIN operadores o ON r.id_operador = o.id
      LEFT JOIN operadores o_res ON r.id_operador_resolucao = o_res.id
      LEFT JOIN vw_pedidos_despacho_completo p ON r.pedidovendaid = p.id
    `;

    const params = [];
    if (status) {
      query += ` WHERE r.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY 
      CASE WHEN r.status = 'ABERTO' THEN 0 ELSE 1 END,
      r.data_relatorio DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit);

    const result = await pool.query(query, params);

    // Parse dos dados_itens JSON
    const relatorios = result.rows.map(r => ({
      ...r,
      dados_itens: typeof r.dados_itens === 'string' ? JSON.parse(r.dados_itens) : r.dados_itens
    }));

    res.json(relatorios);
  } catch (error) {
    console.error("❌ Erro ao listar relatórios:", error);
    res.status(500).json({
      error: 'Erro ao listar relatórios de falta',
      details: error.message
    });
  }
});

// Buscar notificações de falta para usuários específicos
routerSeparacao.get("/notificacoes-falta/:idOperador", async (req, res) => {
  console.log(`🔔 GET /notificacoes-falta/${req.params.idOperador}`);
  try {
    const { idOperador } = req.params;
    
    // Operadores que devem receber notificações: 1, 2, 3, 4, 6, 43
    const operadoresNotificacao = [1, 2, 3, 4, 6, 43];
    
    if (!operadoresNotificacao.includes(parseInt(idOperador))) {
      return res.json({ total: 0, notificacoes: [] });
    }

    const query = `
      SELECT 
        r.id,
        r.pedidovendaid,
        r.data_relatorio,
        r.observacao,
        p.nr_nota_pedidovenda,
        p.cliente_nome,
        o.nome as nome_operador_relator,
        jsonb_array_length(r.dados_itens::jsonb) as total_itens
      FROM relatorios_falta_estoque r
      LEFT JOIN vw_pedidos_despacho_completo p ON r.pedidovendaid = p.id
      LEFT JOIN operadores o ON r.id_operador = o.id
      WHERE r.status = 'ABERTO'
      ORDER BY r.data_relatorio DESC
      LIMIT 10
    `;

    const result = await pool.query(query);

    res.json({
      total: result.rows.length,
      notificacoes: result.rows
    });
  } catch (error) {
    console.error("❌ Erro ao buscar notificações:", error);
    res.status(500).json({
      error: 'Erro ao buscar notificações',
      details: error.message
    });
  }
});

// Resolver/fechar relatório de falta
routerSeparacao.put("/relatorios-falta/:id/resolver", async (req, res) => {
  console.log(`📝 PUT /relatorios-falta/${req.params.id}/resolver`);
  try {
    const { id } = req.params;
    const { id_operador, observacao_resolucao } = req.body;

    console.log(`✅ Resolvendo relatório de falta ${id} - Operador: ${id_operador}`);

    const query = `
      UPDATE relatorios_falta_estoque
      SET 
        status = 'RESOLVIDO',
        data_resolucao = NOW(),
        id_operador_resolucao = $1,
        observacao_resolucao = $2
      WHERE id = $3
      RETURNING *
    `;

    const result = await pool.query(query, [id_operador, observacao_resolucao, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Relatório não encontrado'
      });
    }

    res.json({
      success: true,
      message: 'Relatório resolvido com sucesso',
      dados: result.rows[0]
    });
  } catch (error) {
    console.error("❌ Erro ao resolver relatório:", error);
    res.status(500).json({
      error: 'Erro ao resolver relatório',
      details: error.message
    });
  }
});

// Rota para finalizar pedido
routerSeparacao.post("/pedidos/:id/finalizar", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { id } = req.params;

    console.log(`🏁 Finalizando pedido ${id}`);

    // 1. Verificar se todos os itens da nota foram separados (consolidado por item)
    const verificarItensQuery = `
      WITH nota_ref AS (
        SELECT nr_nota_pedidovenda AS nr_nota
        FROM vw_pedidos_despacho_completo
        WHERE id = $1
        LIMIT 1
      ),
      itens_nota AS (
        SELECT
          pi.pedidovendaitemid,
          MAX(COALESCE(pi.quantidade_entrega, 0)) AS quantidade_solicitada
        FROM vw_pedido_itens_aworks_simples pi
        INNER JOIN vw_pedidos_despacho_completo vw ON vw.id = pi.pedidovendaid
        INNER JOIN nota_ref nr ON nr.nr_nota = vw.nr_nota_pedidovenda
        GROUP BY pi.pedidovendaitemid
      ),
      separacao_agg AS (
        SELECT
          si.pedidovendaitemid,
          SUM(COALESCE(si.quantidade_separada, 0)) AS quantidade_separada,
          BOOL_OR(COALESCE(si.status, '') = 'FINALIZADO') AS status_finalizado
        FROM separacao_itens si
        INNER JOIN separacao_pedidos sp ON sp.id = si.id_separacao_pedido
        INNER JOIN nota_ref nr ON nr.nr_nota = sp.nr_nota_fiscal
        GROUP BY si.pedidovendaitemid
      )
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(itn.quantidade_solicitada, 0) > 0) AS total_itens,
        COUNT(*) FILTER (
          WHERE COALESCE(itn.quantidade_solicitada, 0) > 0
            AND (
              COALESCE(sa.status_finalizado, false)
              OR COALESCE(sa.quantidade_separada, 0) >= COALESCE(itn.quantidade_solicitada, 0)
            )
        ) AS itens_finalizados
      FROM itens_nota itn
      LEFT JOIN separacao_agg sa ON sa.pedidovendaitemid = itn.pedidovendaitemid
    `;

    const verificarResult = await client.query(verificarItensQuery, [id]);

    const { total_itens, itens_finalizados } = verificarResult.rows[0];

    if (parseInt(total_itens) === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Pedido não tem itens para separação",
      });
    }

    if (parseInt(itens_finalizados) < parseInt(total_itens)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Nem todos os itens foram separados",
        detalhes: {
          total_itens: parseInt(total_itens),
          itens_finalizados: parseInt(itens_finalizados),
          faltam: parseInt(total_itens) - parseInt(itens_finalizados),
        },
      });
    }

    // 2. Finalizar o pedido
    const finalizarQuery = `
      UPDATE separacao_pedidos 
      SET 
        status = 'FINALIZADO',
        data_fim_separacao = NOW(),
        updated_at = NOW()
      WHERE nr_nota_fiscal = (
        SELECT nr_nota_pedidovenda
        FROM vw_pedidos_despacho_completo
        WHERE id = $1
        LIMIT 1
      )
      RETURNING *
    `;

    const result = await client.query(finalizarQuery, [id]);

    // 3. Atualizar status dos itens para FINALIZADO se necessário
    const atualizarItensQuery = `
      UPDATE separacao_itens 
      SET status = 'FINALIZADO',
          updated_at = NOW()
      WHERE id_separacao_pedido IN (
        SELECT id FROM separacao_pedidos 
        WHERE nr_nota_fiscal = (
          SELECT nr_nota_pedidovenda
          FROM vw_pedidos_despacho_completo
          WHERE id = $1
          LIMIT 1
        )
      )
      AND status != 'FINALIZADO'
    `;

    await client.query(atualizarItensQuery, [id]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Pedido finalizado com sucesso",
      pedido: result.rows[0],
      estatisticas: {
        total_itens: parseInt(total_itens),
        itens_finalizados: parseInt(itens_finalizados),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao finalizar pedido:", error);
    res.status(500).json({
      error: "Erro ao finalizar pedido",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

routerSeparacao.get("/enderecos-disponiveis/:produtoid", async (req, res) => {
  try {
    const { produtoid } = req.params;

    // Se você tiver uma tabela de endereços, use:
    // const query = `SELECT * FROM enderecos_produtos WHERE produtoid = $1 AND quantidade_disponivel > 0`;

    // Por enquanto, retornar dados de exemplo
    const enderecosExemplo = [
      {
        id_posicao: 1,
        codigo_endereco: "END-001",
        quantidade_disponivel: 100,
        local_estoque: "Armazém A - Prateleira 1",
      },
      {
        id_posicao: 2,
        codigo_endereco: "END-002",
        quantidade_disponivel: 50,
        local_estoque: "Armazém A - Prateleira 2",
      },
    ];

    res.json(enderecosExemplo);
  } catch (error) {
    console.error("❌ Erro ao buscar endereços:", error);
    res.status(500).json({ error: error.message });
  }
});

routerSeparacao.get("/pedidos/:id/itens-simples", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res
        .status(401)
        .json({ message: "Acesso negado: Token não fornecido" });
    }

    const pedidovendaid = parseInt(req.params.id);

    console.log(`🔄 Buscando itens SIMPLES para pedido ${pedidovendaid}`);

    // Query extremamente simples - só os dados básicos
    const query = `
      SELECT 
        pi.pedidovendaitemid,
        pi.pedidovendaid,
        pi.produtoid as produtoid_original,
        pi.ds_produto as produto_descricao,
        pi.referencia as produto_referencia,
        pi.quantidade_entrega as quantidade_solicitada,
        pi.quantidade_despachada,
        (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) as quantidade_pendente,
        
        -- Dados da separação se existir
        COALESCE(si.quantidade_separada, 0) as quantidade_separada,
        COALESCE(si.quantidade_conferida, 0) as quantidade_conferida,
        COALESCE(si.status, 'PENDENTE') as status_item,
        COALESCE(si.observacoes, '') as observacoes,
        
        -- Verificar mapeamento
        (p.id IS NOT NULL) as produto_mapeado,
        COALESCE(p.id, 0) as produtoid_local,
        
        -- Dados fixos para teste
        1000 as estoque_total,
        '[]'::json as enderecos_disponiveis
        
      FROM vw_pedido_itens_aworks_simples pi
      LEFT JOIN produtos p ON p.id_cache = pi.produtoid
      LEFT JOIN separacao_itens si ON pi.pedidovendaitemid = si.pedidovendaitemid
      LEFT JOIN separacao_pedidos sp ON si.id_separacao_pedido = sp.id AND sp.pedidovendaid = $1
      WHERE pi.pedidovendaid = $1
        AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
      ORDER BY pi.ds_produto
    `;

    const result = await pool.query(query, [pedidovendaid]);
    console.log(`✅ ${result.rowCount} itens encontrados (simples)`);

    // Formatar resposta
    const itensFormatados = result.rows.map((item) => ({
      pedidovendaitemid: item.pedidovendaitemid,
      pedidovendaid: item.pedidovendaid,
      produtoid_original: item.produtoid_original,
      produto_descricao: item.produto_descricao,
      produto_referencia: item.produto_referencia,
      quantidade_solicitada: parseFloat(item.quantidade_solicitada) || 0,
      quantidade_despachada: parseFloat(item.quantidade_despachada) || 0,
      quantidade_pendente: parseFloat(item.quantidade_pendente) || 0,
      quantidade_separada: parseFloat(item.quantidade_separada) || 0,
      quantidade_conferida: parseFloat(item.quantidade_conferida) || 0,
      status_item: item.status_item || "PENDENTE",
      observacoes: item.observacoes || "",
      produto_mapeado: Boolean(item.produto_mapeado),
      produtoid_local: item.produtoid_local || 0,
      estoque_total: parseFloat(item.estoque_total) || 0,
      enderecos_disponiveis: [],
      enderecos_selecionados: [],
    }));

    res.json(itensFormatados);
  } catch (error) {
    console.error("❌ Erro ao buscar itens simples:", error);
    res.status(500).json({
      error: "Erro ao buscar itens",
      details: error.message,
    });
  }
});

routerSeparacao.get("/status-sistema", async (req, res) => {
  try {
    const status = {
      database: "OK",
      tabelas: {
        separacao_pedidos: 0,
        separacao_itens: 0,
        produtos: 0,
        contagem_estoque: 0,
      },
      pedidos_sincronizados: 0,
      pedidos_com_itens: 0,
      produtos_sem_mapeamento: 0,
    };

    // Contar registros em cada tabela
    const tabelas = [
      "separacao_pedidos",
      "separacao_itens",
      "produtos",
      "contagem_estoque",
    ];

    for (const tabela of tabelas) {
      const result = await pool.query(`SELECT COUNT(*) FROM ${tabela}`);
      status.tabelas[tabela] = parseInt(result.rows[0].count);
    }

    // Verificar pedidos sincronizados
    const pedidosQuery = await pool.query(`
      SELECT COUNT(DISTINCT sp.pedidovendaid) as total,
             COUNT(DISTINCT CASE WHEN EXISTS (
               SELECT 1 FROM vw_pedido_itens_aworks_simples pi 
               WHERE pi.pedidovendaid = sp.pedidovendaid
                 AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
             ) THEN sp.pedidovendaid END) as com_itens
      FROM separacao_pedidos sp
    `);

    status.pedidos_sincronizados = pedidosQuery.rows[0].total;
    status.pedidos_com_itens = pedidosQuery.rows[0].com_itens;

    // Verificar produtos sem mapeamento
    const mapeamentoQuery = await pool.query(`
      SELECT COUNT(DISTINCT pi.produtoid) as total_sem_mapeamento
      FROM vw_pedido_itens_aworks_simples pi
      WHERE NOT EXISTS (
        SELECT 1 FROM produtos p WHERE p.id_cache = pi.produtoid
      )
        AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
    `);

    status.produtos_sem_mapeamento =
      mapeamentoQuery.rows[0].total_sem_mapeamento;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      status: status,
      recomendacoes:
        status.produtos_sem_mapeamento > 0
          ? `Existem ${status.produtos_sem_mapeamento} produtos sem mapeamento. Execute a sincronização.`
          : "Sistema OK",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

routerSeparacao.get("/produtos/:id/info", async (req, res) => {
  try {
    const produtoid = parseInt(req.params.id);

    const query = `
      SELECT 
        id,
        referencia_produto,
        ds_produto,
        id_cache,
        updated_at
      FROM produtos 
      WHERE id = $1
    `;

    const result = await pool.query(query, [produtoid]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Erro ao buscar info do produto:", error);
    res.status(500).json({
      error: "Erro ao buscar informações do produto",
      details: error.message,
    });
  }
});

// Rota para atualizar estoque após separação
routerSeparacao.post("/estoque/atualizar", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { id_posicao, quantidade_retirada } = req.body;

    console.log(
      `🔄 Atualizando estoque da posição ${id_posicao}: -${quantidade_retirada}`,
    );

    // Buscar contagem atual
    const contagemAtual = await client.query(
      `SELECT id, quantidade_pacotes FROM contagem_estoque 
       WHERE id_posicao = $1 
       ORDER BY data_contagem DESC LIMIT 1`,
      [id_posicao],
    );

    if (contagemAtual.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Posição não encontrada" });
    }

    const quantidadeAtual = parseFloat(
      contagemAtual.rows[0].quantidade_pacotes,
    );
    const novaQuantidade = quantidadeAtual - quantidade_retirada;

    if (novaQuantidade < 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Estoque insuficiente",
        detalhes: {
          quantidade_disponivel: quantidadeAtual,
          quantidade_solicitada: quantidade_retirada,
          faltante: Math.abs(novaQuantidade),
        },
      });
    }

    // Inserir nova contagem com quantidade atualizada
    await client.query(
      `INSERT INTO contagem_estoque 
       (id_posicao, id_produto, quantidade_pacotes, data_contagem, observacao)
       SELECT id_posicao, id_produto, $1, NOW(), 'Baixa por separação'
       FROM contagem_estoque WHERE id = $2`,
      [novaQuantidade, contagemAtual.rows[0].id],
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Estoque atualizado com sucesso",
      posicao: id_posicao,
      quantidade_anterior: quantidadeAtual,
      quantidade_atual: novaQuantidade,
      diferenca: -quantidade_retirada,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao atualizar estoque:", error);
    res.status(500).json({
      error: "Erro ao atualizar estoque",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// Rota para histórico de separação por item
routerSeparacao.get("/itens/:pedidovendaitemid/historico", async (req, res) => {
  try {
    const { pedidovendaitemid } = req.params;

    const query = `
      SELECT 
        si.*,
        u.nome as operador_nome,
        p.codigo as posicao_codigo,
        CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) as endereco_completo,
        prod.ds_produto,
        prod.referencia_produto
      FROM separacao_itens si
      LEFT JOIN usuarios u ON si.id_operador_separacao = u.id
      LEFT JOIN posicoes p ON si.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN produtos prod ON si.id_produto = prod.id
      WHERE si.pedidovendaitemid = $1
      ORDER BY si.updated_at DESC
    `;

    const result = await pool.query(query, [pedidovendaitemid]);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar histórico:", error);
    res.status(500).json({
      error: "Erro ao buscar histórico",
      details: error.message,
    });
  }
});

app.get("/api/public/debug/hierarquia/:id_posicao", async (req, res) => {
  try {
    const id_posicao = parseInt(req.params.id_posicao);

    const query = `
      SELECT 
        p.id as posicao_id,
        p.codigo as posicao_codigo,
        p.descricao as posicao_descricao,
        n.id as nivel_id,
        n.codigo as nivel_codigo,
        n.descricao as nivel_descricao,
        m.id as modulo_id,
        m.codigo as modulo_codigo,
        m.descricao as modulo_descricao,
        r.id as rua_id,
        r.codigo as rua_codigo,
        r.descricao as rua_descricao,
        le.id as local_estoque_id,
        le.codigo as local_estoque_codigo,
        le.descricao as local_estoque_descricao
      FROM posicoes p
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN locais_estoque le ON p.id_local_estoque = le.id
      WHERE p.id = $1
    `;

    const result = await pool.query(query, [id_posicao]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Posição não encontrada" });
    }

    res.json({
      encontrado: true,
      hierarquia: result.rows[0],
      resumo: `Rua: ${result.rows[0].rua_descricao} | Módulo: ${result.rows[0].modulo_descricao} | Nível: ${result.rows[0].nivel_descricao} | Posição: ${result.rows[0].posicao_descricao}`,
    });
  } catch (error) {
    console.error("Erro ao buscar hierarquia:", error);
    res.status(500).json({ error: error.message });
  }
});
// 🔹 ROTA DEBUG: Verificar estrutura de uma posição específica
app.get("/api/public/debug/posicao/:id_posicao", async (req, res) => {
  const { id_posicao } = req.params;

  try {
    const query = `
      SELECT 
        p.id AS posicao_id,
        p.codigo AS posicao_codigo,
        p.descricao AS posicao_descricao,
        n.id AS nivel_id,
        n.codigo AS nivel_codigo,
        n.descricao AS nivel_descricao,
        m.id AS modulo_id,
        m.codigo AS modulo_codigo,
        m.descricao AS modulo_descricao,
        r.id AS rua_id,
        r.codigo AS rua_codigo,
        r.descricao AS rua_descricao,
        le.id AS local_id,
        le.codigo AS local_codigo,
        le.descricao AS local_descricao
      FROM posicoes p
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN locais_estoque le ON p.id_local_estoque = le.id
      WHERE p.id = $1;
    `;

    const result = await pool.query(query, [id_posicao]);

    if (result.rows.length === 0) {
      return res.json({
        encontrado: false,
        id_posicao,
      });
    }

    const dados = result.rows[0];

    res.json({
      encontrado: true,
      id_posicao,
      posicao: {
        id: dados.posicao_id,
        codigo: dados.posicao_codigo,
        descricao: dados.posicao_descricao,
      },
      nivel: {
        id: dados.nivel_id,
        codigo: dados.nivel_codigo,
        descricao: dados.nivel_descricao,
      },
      modulo: {
        id: dados.modulo_id,
        codigo: dados.modulo_codigo,
        descricao: dados.modulo_descricao,
      },
      rua: {
        id: dados.rua_id,
        codigo: dados.rua_codigo,
        descricao: dados.rua_descricao,
      },
      local_estoque: {
        id: dados.local_id,
        codigo: dados.local_codigo,
        descricao: dados.local_descricao,
      },
      resumo: `Rua: ${dados.rua_codigo} | Módulo: ${dados.modulo_codigo} | Nível: ${dados.nivel_codigo} | Posição: ${dados.posicao_codigo}`,
    });
  } catch (error) {
    console.error("❌ Erro ao buscar estrutura da posição:", error);
    res.status(500).json({
      erro: "Erro ao buscar estrutura",
      detalhes: error.message,
    });
  }
});

// ==================== VALIDAÇÃO COM CÓDIGO DE BARRAS ====================

// Validar código de barras da posição
routerSeparacao.post("/validar-posicao", async (req, res) => {
  try {
    const { codigo_barras, id_posicao_esperado } = req.body;

    console.log('🔍 Validando posição:', { codigo_barras, id_posicao_esperado });

    const resultado = await pool.query(
      `SELECT 
        p.id AS id_posicao,
        p.codigo AS codigo_posicao,
        p.descricao AS descricao_posicao,
        p.codigo_barras,
        n.codigo AS codigo_nivel,
        n.descricao AS descricao_nivel,
        m.codigo AS codigo_modulo,
        m.descricao AS descricao_modulo,
        r.codigo AS codigo_rua,
        r.descricao AS descricao_rua,
        le.descricao AS local_estoque_descricao
      FROM posicoes p
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      INNER JOIN locais_estoque le ON p.id_local_estoque = le.id
      WHERE p.codigo_barras = $1`,
      [codigo_barras]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ 
        valido: false, 
        erro: 'Código de barras não encontrado' 
      });
    }

    const posicao = resultado.rows[0];

    // Verificar se é a posição esperada
    if (id_posicao_esperado && posicao.id_posicao !== id_posicao_esperado) {
      return res.status(400).json({
        valido: false,
        erro: 'Posição incorreta',
        posicao_escaneada: posicao,
        mensagem: `Você escaneou ${posicao.codigo_posicao} mas deveria ser a posição ID ${id_posicao_esperado}`
      });
    }

    res.json({
      valido: true,
      posicao: posicao
    });

  } catch (error) {
    console.error('❌ Erro ao validar posição:', error);
    res.status(500).json({ erro: 'Erro ao validar código de barras da posição' });
  }
});

// Buscar produto por EAN13 ou EAN14
routerSeparacao.post("/buscar-por-ean", async (req, res) => {
  try {
    const { codigo_barras, id_cache } = req.body;

    console.log('🔍 Buscando produto por EAN:', { codigo_barras, id_cache });

    // Primeiro, tentar buscar como EAN13 (ean13)
    let resultado = await pool.query(
      `SELECT 
        pc.id AS id_cache,
        pc.id AS id_original,
        pc.ean13 AS referencia_produto,
        pc.descricao AS descricao_produto,
        1 as quantidade_embalagem,
        'EAN13' as tipo_codigo
      FROM produtos_cache pc
      WHERE pc.ean13 = $1`,
      [codigo_barras]
    );

    // Se não encontrar, buscar como EAN14 na view materializada
    if (resultado.rows.length === 0) {
      resultado = await pool.query(
        `SELECT 
          pc.id AS id_cache,
          pc.id AS id_original,
          pc.ean13 AS referencia_produto,
          pc.descricao AS descricao_produto,
          pe.quantidade as quantidade_embalagem,
          CASE 
            WHEN pe.ean14 LIKE '1%' THEN 'PACOTE'
            WHEN pe.ean14 LIKE '2%' THEN 'MASTER'
            ELSE 'MASTER_EXTRA'
          END as tipo_codigo,
          pe.ean14
        FROM produtos_ean14 pe
        INNER JOIN produtos_cache pc ON pe.id_produto = pc.id
        WHERE pe.ean14 = $1`,
        [codigo_barras]
      );
    }

    if (resultado.rows.length === 0) {
      return res.status(404).json({ 
        encontrado: false, 
        erro: 'Código de barras não encontrado' 
      });
    }

    const produto = resultado.rows[0];

    // Verificar se é o produto correto (se id_cache foi fornecido)
    if (id_cache && produto.id_cache !== id_cache) {
      return res.status(400).json({
        encontrado: true,
        produto_correto: false,
        erro: 'Produto incorreto',
        produto_escaneado: produto,
        mensagem: `Você escaneou ${produto.descricao_produto} mas deveria ser outro produto`
      });
    }

    res.json({
      encontrado: true,
      produto_correto: true,
      produto: produto
    });

  } catch (error) {
    console.error('❌ Erro ao buscar produto por EAN:', error);
    res.status(500).json({ erro: 'Erro ao buscar produto por código de barras' });
  }
});

// Buscar todas as opções de EAN14 para um produto
routerSeparacao.get("/produto/:id_cache/ean14", async (req, res) => {
  try {
    const { id_cache } = req.params;

    const resultado = await pool.query(
      `SELECT 
        pe.id,
        pe.ean14,
        pe.quantidade,
        CASE 
          WHEN pe.ean14 LIKE '1%' THEN 'PACOTE'
          WHEN pe.ean14 LIKE '2%' THEN 'MASTER'
          ELSE 'MASTER_EXTRA'
        END as tipo_embalagem
      FROM produtos_ean14 pe
      INNER JOIN produtos_cache pc ON pe.id_produto = pc.id
      WHERE pc.id = $1
      ORDER BY pe.quantidade ASC`,
      [id_cache]
    );

    res.json(resultado.rows);

  } catch (error) {
    console.error('❌ Erro ao buscar EAN14:', error);
    res.status(500).json({ erro: 'Erro ao buscar opções de embalagem' });
  }
});

// ==================== BLOQUEIOS DE ITENS ====================

const STALE_LOCK_INTERVAL = "20 minutes";

async function liberarBloqueioInativo(clientOrPool, pedidovendaitemid) {
  const result = await clientOrPool.query(
    `UPDATE public.separacao_itens
     SET bloqueado_por = NULL,
         data_bloqueio = NULL,
         updated_at = NOW()
     WHERE pedidovendaitemid = $1
       AND bloqueado_por IS NOT NULL
       AND (
         data_bloqueio < NOW() - ($2::text)::interval
         OR data_bloqueio IS NULL
       )
     RETURNING pedidovendaitemid`,
    [pedidovendaitemid, STALE_LOCK_INTERVAL]
  );

  return result.rowCount || 0;
}

/**
 * Bloquear um item para um operador específico
 * Apenas um operador pode trabalhar nele por vez
 */
routerSeparacao.post("/separacao-itens/:pedidovendaitemid/bloquear", async (req, res) => {
  const { pedidovendaitemid } = req.params;
  const { id_operador } = req.body;

  try {
    const liberados = await liberarBloqueioInativo(pool, pedidovendaitemid);
    if (liberados > 0) {
      console.log(`🧹 Bloqueio inativo liberado para item ${pedidovendaitemid}`);
    }

    const result = await pool.query(
      'SELECT * FROM public.bloquear_item_separacao($1, $2)',
      [pedidovendaitemid, id_operador]
    );

    const response = result.rows[0];
    const statusCode = response.sucesso ? 200 : 409;

    res.status(statusCode).json({
      sucesso: response.sucesso,
      mensagem: response.mensagem,
      bloqueado_por: response.bloqueado_por,
      nome_operador: response.nome_operador
    });

    if (response.sucesso) {
      await registrarLog(
        'BLOQUEAR_ITEM_SEPARACAO',
        `Item ${pedidovendaitemid} bloqueado`,
        { pedidovendaitemid, id_operador },
        null,
        id_operador
      );
    }
  } catch (error) {
    console.error('❌ Erro ao bloquear item:', error);
    res.status(500).json({
      erro: "Erro ao bloquear item",
      detalhes: error.message
    });
  }
});

/**
 * Desbloquear um item (libera para outro operador)
 */
routerSeparacao.post("/separacao-itens/:pedidovendaitemid/desbloquear", async (req, res) => {
  const { pedidovendaitemid } = req.params;
  const { id_operador } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await liberarBloqueioInativo(client, pedidovendaitemid);

    const itemResult = await client.query(
      `SELECT
         si.id,
         si.id_separacao_pedido,
         si.bloqueado_por,
         si.data_bloqueio,
         si.quantidade_solicitada,
         si.quantidade_separada,
         si.quantidade_separada_inicial
       FROM public.separacao_itens si
       WHERE si.pedidovendaitemid = $1
         AND si.bloqueado_por IS NOT NULL
       ORDER BY si.data_bloqueio DESC NULLS LAST,
                si.updated_at DESC NULLS LAST,
                si.id DESC
       LIMIT 1
       FOR UPDATE`,
      [pedidovendaitemid]
    );

    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        sucesso: false,
        mensagem: 'Item não está bloqueado'
      });
    }

    const item = itemResult.rows[0];
    const operadorIdNumerico = Number(id_operador);
    const bloqueadoPorNumerico = Number(item.bloqueado_por);

    if (!Number.isInteger(operadorIdNumerico) || operadorIdNumerico <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Operador inválido'
      });
    }

    if (bloqueadoPorNumerico !== operadorIdNumerico) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Apenas o operador que bloqueou pode desbloquear'
      });
    }

    const pedidoResult = await client.query(
      `SELECT pedidovendaid
       FROM public.separacao_pedidos
       WHERE id = $1`,
      [item.id_separacao_pedido]
    );

    const pedidovendaid = pedidoResult.rows[0]?.pedidovendaid || null;

    await client.query(
      `INSERT INTO public.separacao_itens_bloqueio (
        pedidovendaitemid,
        pedidovendaid,
        bloqueado_por,
        desbloqueado_por,
        data_bloqueio,
        data_desbloqueio,
        quantidade_solicitada,
        quantidade_separada_quando_bloqueado,
        quantidade_separada_quando_desbloqueado,
        motivo_desbloqueio
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8, 'FINALIZADO_PARCIAL')`,
      [
        pedidovendaitemid,
        pedidovendaid,
        item.bloqueado_por,
        operadorIdNumerico,
        item.data_bloqueio,
        item.quantidade_solicitada,
        item.quantidade_separada_inicial,
        item.quantidade_separada
      ]
    );

    await client.query(
      `UPDATE public.separacao_itens
       SET bloqueado_por = NULL,
           data_bloqueio = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [item.id]
    );

    await client.query('COMMIT');

    const response = {
      sucesso: true,
      mensagem: 'Item desbloqueado com sucesso'
    };
    const statusCode = 200;

    res.status(statusCode).json({
      sucesso: response.sucesso,
      mensagem: response.mensagem
    });

    if (response.sucesso) {
      await registrarLog(
        'DESBLOQUEAR_ITEM_SEPARACAO',
        `Item ${pedidovendaitemid} desbloqueado`,
        { pedidovendaitemid, id_operador },
        null,
        id_operador
      );
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao desbloquear item:', error);
    res.status(500).json({
      erro: "Erro ao desbloquear item",
      detalhes: error.message
    });
  } finally {
    client.release();
  }
});

/**
 * Verificar bloqueio de um item
 */
routerSeparacao.get("/separacao-itens/:pedidovendaitemid/bloqueio", async (req, res) => {
  const { pedidovendaitemid } = req.params;

  try {
    const liberados = await liberarBloqueioInativo(pool, pedidovendaitemid);
    if (liberados > 0) {
      console.log(`🧹 Bloqueio inativo liberado na consulta de bloqueio para item ${pedidovendaitemid}`);
    }

    const result = await pool.query(
      `SELECT 
        bloqueado,
        bloqueado_por,
        nome_operador,
        data_bloqueio
      FROM public.verificar_bloqueio_item($1)`,
      [pedidovendaitemid]
    );

    const response = result.rows[0] || {
      bloqueado: false,
      bloqueado_por: null,
      nome_operador: null,
      data_bloqueio: null
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('❌ Erro ao verificar bloqueio:', error);
    res.status(500).json({
      erro: "Erro ao verificar bloqueio",
      detalhes: error.message
    });
  }
});

/**
 * Finalizar separação parcial de um item
 * Quantidade restante fica livre para outro operador
 */
routerSeparacao.post("/separacao-itens/:pedidovendaitemid/finalizar-parcial", async (req, res) => {
  const { pedidovendaitemid } = req.params;
  const { quantidade_separada, id_operador, observacao } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await liberarBloqueioInativo(client, pedidovendaitemid);

    const quantidadeSeparadaNumerica = Number(quantidade_separada);
    const operadorIdNumerico = Number(id_operador);

    if (!Number.isFinite(quantidadeSeparadaNumerica) || quantidadeSeparadaNumerica < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Quantidade separada inválida',
        quantidade_restante: 0
      });
    }

    if (!Number.isInteger(operadorIdNumerico) || operadorIdNumerico <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Operador inválido',
        quantidade_restante: 0
      });
    }

    const itemResult = await client.query(
      `SELECT
        si.id,
        si.quantidade_solicitada,
        si.quantidade_conferida,
        si.quantidade_separada_inicial,
        si.data_bloqueio,
        si.id_separacao_pedido,
        si.bloqueado_por
      FROM public.separacao_itens si
      WHERE si.pedidovendaitemid = $1
      ORDER BY CASE WHEN si.bloqueado_por IS NOT NULL THEN 0 ELSE 1 END,
               si.data_bloqueio DESC NULLS LAST,
               si.updated_at DESC NULLS LAST,
               si.id DESC
      LIMIT 1
      FOR UPDATE`,
      [pedidovendaitemid]
    );

    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        sucesso: false,
        mensagem: 'Item não foi encontrado para finalizar parcialmente',
        quantidade_restante: 0
      });
    }

    const item = itemResult.rows[0];
    let nomeOperadorBloqueio = null;

    if (item.bloqueado_por) {
      const operadorResult = await client.query(
        `SELECT nome
        FROM public.operadores
        WHERE id = $1`,
        [item.bloqueado_por]
      );

      nomeOperadorBloqueio = operadorResult.rows[0]?.nome || null;
    }

    if (!item.bloqueado_por) {
      await client.query(
        `UPDATE public.separacao_itens
         SET bloqueado_por = $2,
             data_bloqueio = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [item.id, operadorIdNumerico]
      );

      item.bloqueado_por = operadorIdNumerico;
      item.data_bloqueio = new Date();
    }

    if (Number(item.bloqueado_por) !== operadorIdNumerico) {
      await client.query('ROLLBACK');

      const mensagem = item.bloqueado_por
        ? `Este item está bloqueado por ${nomeOperadorBloqueio || 'outro operador'}`
        : 'Este item não está mais bloqueado para este operador';

      return res.status(409).json({
        sucesso: false,
        mensagem,
        quantidade_restante: 0,
        bloqueado_por: item.bloqueado_por || null,
        nome_operador: nomeOperadorBloqueio
      });
    }

    const pedidoResult = await client.query(
      `SELECT pedidovendaid
      FROM public.separacao_pedidos
      WHERE id = $1`,
      [item.id_separacao_pedido]
    );

    const pedidovendaid = pedidoResult.rows[0]?.pedidovendaid || null;
    const quantidadeSolicitada = Number(item.quantidade_solicitada) || 0;
    const quantidadeRestante = Math.max(0, quantidadeSolicitada - quantidadeSeparadaNumerica);

    await client.query(
      `INSERT INTO public.separacao_itens_bloqueio (
        pedidovendaitemid,
        pedidovendaid,
        bloqueado_por,
        desbloqueado_por,
        data_bloqueio,
        data_desbloqueio,
        quantidade_solicitada,
        quantidade_separada_quando_bloqueado,
        quantidade_separada_quando_desbloqueado,
        motivo_desbloqueio,
        observacoes
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8, 'FINALIZADO_PARCIAL', $9)`,
      [
        pedidovendaitemid,
        pedidovendaid,
        item.bloqueado_por,
        operadorIdNumerico,
        item.data_bloqueio,
        item.quantidade_solicitada,
        item.quantidade_separada_inicial,
        quantidadeSeparadaNumerica,
        observacao || null
      ]
    );

    await client.query(
      `UPDATE public.separacao_itens
      SET bloqueado_por = NULL,
          data_bloqueio = NULL,
          updated_at = NOW()
      WHERE id = $1`,
      [item.id]
    );

    await client.query('COMMIT');

    const response = {
      sucesso: true,
      mensagem: `Separação parcial finalizada. Quantidade restante (${quantidadeRestante}) liberada para outro operador`,
      quantidade_restante: quantidadeRestante
    };
    const statusCode = response.sucesso ? 200 : 409;

    res.status(statusCode).json({
      sucesso: response.sucesso,
      mensagem: response.mensagem,
      quantidade_restante: response.quantidade_restante
    });

    if (response.sucesso) {
      await registrarLog(
        'FINALIZAR_SEPARACAO_PARCIAL',
        `Item ${pedidovendaitemid} finalizado parcialmente. Quantidade: ${quantidade_separada}`,
        { pedidovendaitemid, quantidade_separada, id_operador },
        null,
        id_operador,
        'INFO'
      );
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao finalizar separação parcial:', error);
    res.status(500).json({
      erro: "Erro ao finalizar separação parcial",
      detalhes: error.message
    });
  } finally {
    client.release();
  }
});

// =============================================
// ROTAS DE DASHBOARD - SEPARACAO
// =============================================

const routerDashboard = express.Router();
routerDashboard.use(autenticarToken);

const DASHBOARD_SEPARACAO_DATA_INICIAL = "2026-04-27";

function parsePeriodoDashboard(dataInicio, dataFim) {
  const fim = dataFim ? new Date(dataFim) : new Date();
  const inicio = dataInicio ? new Date(dataInicio) : new Date(fim.getTime() - 30 * 24 * 60 * 60 * 1000);
  const inicioFormatado = inicio.toISOString().slice(0, 10);
  return {
    inicio: inicioFormatado < DASHBOARD_SEPARACAO_DATA_INICIAL ? DASHBOARD_SEPARACAO_DATA_INICIAL : inicioFormatado,
    fim: fim.toISOString().slice(0, 10),
  };
}

function formatarTempoMinutos(minutos) {
  const valor = Number(minutos || 0);
  return `${Math.max(0, Math.round(valor))} min`;
}

routerDashboard.get("/metricas/geral", async (req, res) => {
  try {
    const { inicio, fim } = parsePeriodoDashboard(req.query.dataInicio, req.query.dataFim);
    const inicioEfetivo = inicio;

    const atual = await pool.query(
      `
      WITH pedidos AS (
        SELECT
          COUNT(*) AS total_pedidos,
          COUNT(*) FILTER (WHERE status IN ('FINALIZADO', 'CONFERIDO')) AS finalizados,
          AVG(EXTRACT(EPOCH FROM (data_fim_separacao - data_inicio_separacao)) / 60)
            FILTER (WHERE data_inicio_separacao IS NOT NULL AND data_fim_separacao IS NOT NULL) AS tempo_medio_min
        FROM separacao_pedidos
        WHERE created_at::date BETWEEN $1::date AND $2::date
      ),
      itens AS (
        SELECT
          COUNT(*) AS total_itens,
          COUNT(*) FILTER (WHERE data_separacao IS NOT NULL) AS itens_separados,
          -- Acurácia: comparar quantidade separada vs solicitada (real medição de performance)
          AVG(
            CASE
              WHEN COALESCE(quantidade_solicitada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_separada, 0) >= COALESCE(quantidade_solicitada, 0) THEN 100
              ELSE ROUND((COALESCE(quantidade_separada, 0) * 100.0 / NULLIF(quantidade_solicitada, 0))::numeric, 1)
            END
          ) FILTER (WHERE data_separacao IS NOT NULL) AS acuracia,
          -- Taxa de divergência: itens separados com quantidade menor que a solicitada
          ROUND(
            COUNT(*) FILTER (
              WHERE data_separacao IS NOT NULL
                AND COALESCE(quantidade_separada, 0) < COALESCE(quantidade_solicitada, 0)
                AND COALESCE(quantidade_solicitada, 0) > 0
            ) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE data_separacao IS NOT NULL), 0),
            1
          ) AS taxa_divergencia
        FROM separacao_itens
        WHERE created_at::date BETWEEN $1::date AND $2::date
      ),
      operadores AS (
        SELECT
          COUNT(DISTINCT id_operador_separacao) AS operadores_ativos,
          COUNT(DISTINCT data_separacao::date) AS dias_ativos
        FROM separacao_itens
        WHERE data_separacao IS NOT NULL
          AND data_separacao::date BETWEEN $1::date AND $2::date
      )
      SELECT
        p.total_pedidos,
        p.finalizados,
        p.tempo_medio_min,
        i.total_itens,
        i.itens_separados,
        i.acuracia,
        i.taxa_divergencia,
        o.operadores_ativos,
        o.dias_ativos
      FROM pedidos p, itens i, operadores o
      `,
      [inicioEfetivo, fim]
    );

    const row = atual.rows[0] || {};
    const eficiencia = row.total_pedidos > 0 ? (Number(row.finalizados || 0) * 100) / Number(row.total_pedidos) : 0;
    const acuracia = Number(row.acuracia || 0);
    const taxaErro = Number(row.taxa_divergencia || 0);
    // Picking rate: itens separados por operador por hora (base 8h/dia útil)
    const baseHoras = Number(row.operadores_ativos || 0) * Number(row.dias_ativos || 0) * 8;
    const pickingRate = baseHoras > 0 ? Number(row.itens_separados || 0) / baseHoras : 0;
    const utilizacaoOperador = eficiencia;

    const diasPeriodo = Math.max(1, Math.round((new Date(fim) - new Date(inicioEfetivo)) / (24 * 60 * 60 * 1000)) + 1);
    const fimAnterior = new Date(inicioEfetivo);
    fimAnterior.setDate(fimAnterior.getDate() - 1);
    const inicioAnterior = new Date(fimAnterior);
    inicioAnterior.setDate(inicioAnterior.getDate() - diasPeriodo + 1);
    // Não comparar com período anterior ao início do sistema
    const inicioAnteriorEfetivo = inicioAnterior < new Date(DASHBOARD_SEPARACAO_DATA_INICIAL)
      ? new Date(DASHBOARD_SEPARACAO_DATA_INICIAL)
      : inicioAnterior;

    const anterior = await pool.query(
      `
      WITH pedidos AS (
        SELECT
          COUNT(*) AS total_pedidos,
          COUNT(*) FILTER (WHERE status IN ('FINALIZADO', 'CONFERIDO')) AS finalizados
        FROM separacao_pedidos
        WHERE created_at::date BETWEEN $1::date AND $2::date
      ),
      itens AS (
        SELECT
          COUNT(*) FILTER (WHERE data_separacao IS NOT NULL) AS itens_separados,
          AVG(
            CASE
              WHEN COALESCE(quantidade_solicitada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_separada, 0) >= COALESCE(quantidade_solicitada, 0) THEN 100
              ELSE ROUND((COALESCE(quantidade_separada, 0) * 100.0 / NULLIF(quantidade_solicitada, 0))::numeric, 1)
            END
          ) FILTER (WHERE data_separacao IS NOT NULL) AS acuracia,
          ROUND(
            COUNT(*) FILTER (
              WHERE data_separacao IS NOT NULL
                AND COALESCE(quantidade_separada, 0) < COALESCE(quantidade_solicitada, 0)
                AND COALESCE(quantidade_solicitada, 0) > 0
            ) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE data_separacao IS NOT NULL), 0),
            1
          ) AS taxa_divergencia
        FROM separacao_itens
        WHERE created_at::date BETWEEN $1::date AND $2::date
      ),
      operadores AS (
        SELECT
          COUNT(DISTINCT id_operador_separacao) AS operadores_ativos,
          COUNT(DISTINCT data_separacao::date) AS dias_ativos
        FROM separacao_itens
        WHERE data_separacao IS NOT NULL
          AND data_separacao::date BETWEEN $1::date AND $2::date
      )
      SELECT p.total_pedidos, p.finalizados, i.itens_separados, i.acuracia, i.taxa_divergencia, o.operadores_ativos, o.dias_ativos
      FROM pedidos p, itens i, operadores o
      `,
      [inicioAnteriorEfetivo.toISOString().slice(0, 10), fimAnterior.toISOString().slice(0, 10)]
    );

    const prev = anterior.rows[0] || {};
    const prevEf = prev.total_pedidos > 0 ? (Number(prev.finalizados || 0) * 100) / Number(prev.total_pedidos) : 0;
    const prevAc = Number(prev.acuracia || 0);
    const prevBaseHoras = Number(prev.operadores_ativos || 0) * Number(prev.dias_ativos || 0) * 8;
    const prevPr = prevBaseHoras > 0 ? Number(prev.itens_separados || 0) / prevBaseHoras : 0;
    const prevErr = Number(prev.taxa_divergencia || 0);

    const tendencia = (atualValor, anteriorValor) => {
      if (!isFinite(atualValor) || !isFinite(anteriorValor)) return 0;
      if (anteriorValor === 0) return atualValor > 0 ? 100 : 0;
      return Number(((atualValor - anteriorValor) * 100) / Math.abs(anteriorValor));
    };

    return res.json({
      eficiencia: Number(eficiencia.toFixed(1)),
      acuracia: Number(acuracia.toFixed(1)),
      pickingRate: Number(pickingRate.toFixed(1)),
      taxaErro: Number(taxaErro.toFixed(1)),
      tempoMedioPedido: formatarTempoMinutos(row.tempo_medio_min),
      utilizacaoOperador: Number(utilizacaoOperador.toFixed(1)),
      tendencias: {
        eficiencia: Number(tendencia(eficiencia, prevEf).toFixed(1)),
        acuracia: Number(tendencia(acuracia, prevAc).toFixed(1)),
        pickingRate: Number(tendencia(pickingRate, prevPr).toFixed(1)),
        taxaErro: Number(tendencia(taxaErro, prevErr).toFixed(1)),
      },
    });
  } catch (error) {
    console.error("Erro em /dashboard/metricas/geral:", error);
    return res.status(500).json({ erro: "Erro ao carregar metricas gerais", detalhes: error.message });
  }
});

routerDashboard.get("/metricas/operador/:idOperador", async (req, res) => {
  try {
    const { idOperador } = req.params;
    const { inicio, fim } = parsePeriodoDashboard(req.query.dataInicio, req.query.dataFim);

    const result = await pool.query(
      `
      SELECT
        o.id,
        o.nome,
        COUNT(si.id) AS total_itens,
        COUNT(DISTINCT si.id_separacao_pedido) AS total_pedidos,
        AVG(
          CASE
            WHEN COALESCE(si.quantidade_separada, 0) <= 0 THEN 100
            WHEN COALESCE(si.quantidade_conferida, 0) >= COALESCE(si.quantidade_separada, 0) THEN 100
            ELSE (COALESCE(si.quantidade_conferida, 0) * 100.0 / NULLIF(si.quantidade_separada, 0))
          END
        ) AS acuracia,
        SUM(
          GREATEST(
            EXTRACT(EPOCH FROM (COALESCE(si.updated_at, NOW()) - COALESCE(si.data_separacao, si.created_at))) / 3600,
            0
          )
        ) AS horas,
        AVG(
          EXTRACT(EPOCH FROM (COALESCE(si.updated_at, NOW()) - COALESCE(si.data_separacao, si.created_at))) / 60
        ) AS tempo_medio_min
      FROM operadores o
      LEFT JOIN separacao_itens si
        ON si.id_operador_separacao = o.id
       AND si.created_at::date BETWEEN $2::date AND $3::date
      WHERE o.id = $1
      GROUP BY o.id, o.nome
      `,
      [idOperador, inicio, fim]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: "Operador nao encontrado" });
    }

    const row = result.rows[0];
    const pickingRate = Number(row.horas || 0) > 0 ? Number(row.total_itens || 0) / Number(row.horas) : 0;

    const erros = await pool.query(
      `
      SELECT
        tipo,
        COUNT(*)::int AS count,
        ROUND((COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0)), 2) AS percentual
      FROM (
        SELECT
          CASE
            WHEN COALESCE(quantidade_separada, 0) > 0 AND COALESCE(quantidade_conferida, 0) < COALESCE(quantidade_separada, 0) THEN 'QUANTIDADE'
            WHEN id_posicao IS NULL THEN 'POSICAO'
            ELSE 'DIVERGENCIA'
          END AS tipo
        FROM separacao_itens
        WHERE id_operador_separacao = $1
          AND created_at::date BETWEEN $2::date AND $3::date
      ) x
      GROUP BY tipo
      ORDER BY count DESC
      LIMIT 5
      `,
      [idOperador, inicio, fim]
    );

    return res.json({
      id: row.id,
      nome: row.nome,
      totalItens: Number(row.total_itens || 0),
      totalPedidos: Number(row.total_pedidos || 0),
      acuracia: Number(Number(row.acuracia || 100).toFixed(1)),
      pickingRate: Number(pickingRate.toFixed(1)),
      tempoMedio: formatarTempoMinutos(row.tempo_medio_min),
      errosFrequentes: erros.rows.map((e) => ({
        tipo: e.tipo,
        count: Number(e.count || 0),
        percentual: Number(e.percentual || 0),
      })),
    });
  } catch (error) {
    console.error("Erro em /dashboard/metricas/operador:", error);
    return res.status(500).json({ erro: "Erro ao carregar metricas do operador", detalhes: error.message });
  }
});

routerDashboard.get("/graficos/produtividade-diaria", async (req, res) => {
  try {
    const dataInicio = req.query.dataInicio || "2026-04-27";
    const dataFim = req.query.dataFim || new Date().toISOString().split('T')[0];
    
    // Usa data_separacao (data real do picking) em vez de created_at (criação do registro)
    // A taxa itens/hora é estimada: itens separados / (operadores ativos * 8h)
    const result = await pool.query(
      `
      SELECT
        TO_CHAR(data_separacao::date, 'YYYY-MM-DD') AS data,
        COUNT(*)::int AS itens_separados,
        COUNT(DISTINCT id_operador_separacao)::int AS operadores_ativos,
        ROUND(
          COUNT(*)::numeric / NULLIF(COUNT(DISTINCT id_operador_separacao) * 8.0, 0),
          1
        ) AS itens_hora
      FROM separacao_itens
      WHERE data_separacao IS NOT NULL
        AND data_separacao::date >= $1::date
        AND data_separacao::date <= $2::date
      GROUP BY data_separacao::date
      ORDER BY data_separacao::date
      `
    ,
      [dataInicio, dataFim]
    );

    return res.json(
      result.rows.map((r) => ({
        data: r.data,
        itensHora: Number(r.itens_hora || 0),
        itensSeparados: Number(r.itens_separados || 0),
        operadoresAtivos: Number(r.operadores_ativos || 0),
        meta: 40,
        minimo: 30,
      }))
    );
  } catch (error) {
    console.error("Erro em /dashboard/graficos/produtividade-diaria:", error);
    return res.status(500).json({ erro: "Erro ao carregar grafico de produtividade", detalhes: error.message });
  }
});

routerDashboard.get("/graficos/top-operadores", async (req, res) => {
  try {
    const limite = Math.max(1, Math.min(Number(req.query.limite || 5), 20));
    const periodo = (req.query.periodo || "dia").toString();
  const dataInicio = req.query.dataInicio || "2026-04-27";
  const dataFim = req.query.dataFim || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `
      SELECT
        o.id,
        o.nome,
        COUNT(si.id)::int AS itens,
        ROUND(
          AVG(
            CASE
              WHEN COALESCE(si.quantidade_separada, 0) <= 0 THEN 100
              WHEN COALESCE(si.quantidade_conferida, 0) >= COALESCE(si.quantidade_separada, 0) THEN 100
              ELSE (COALESCE(si.quantidade_conferida, 0) * 100.0 / NULLIF(si.quantidade_separada, 0))
            END
          ),
          1
        ) AS acuracia,
        ROUND(
          COUNT(si.id)::numeric /
          NULLIF(
            SUM(
              GREATEST(
                EXTRACT(EPOCH FROM (COALESCE(si.updated_at, NOW()) - COALESCE(si.data_separacao, si.created_at))) / 3600,
                0.05
              )
            ),
            0
          ),
          1
        ) AS picking_rate
      FROM separacao_itens si
      JOIN operadores o ON o.id = si.id_operador_separacao
      WHERE si.data_separacao::date >= $1::date
        AND si.data_separacao::date <= $2::date
      GROUP BY o.id, o.nome
      ORDER BY itens DESC
      LIMIT $3
      `,
      [dataInicio, dataFim, limite]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Erro em /dashboard/graficos/top-operadores:", error);
    return res.status(500).json({ erro: "Erro ao carregar top operadores", detalhes: error.message });
  }
});

routerDashboard.get("/graficos/status-pedidos", async (req, res) => {
  try {
    const dataInicio = req.query.dataInicio || "2026-04-27";
    const dataFim = req.query.dataFim || new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDENTE')::int AS pendentes,
        COUNT(*) FILTER (WHERE status = 'EM_SEPARACAO')::int AS em_separacao,
        COUNT(*) FILTER (WHERE status = 'CONFERIDO')::int AS conferidos,
        COUNT(*) FILTER (WHERE status = 'FINALIZADO')::int AS expedidos
      FROM separacao_pedidos
      WHERE created_at::date >= $1::date
        AND created_at::date <= $2::date
      `
    ,
      [dataInicio, dataFim]
    );

    const row = result.rows[0] || {};
    return res.json({
      pendentes: Number(row.pendentes || 0),
      emSeparacao: Number(row.em_separacao || 0),
      conferidos: Number(row.conferidos || 0),
      expedidos: Number(row.expedidos || 0),
    });
  } catch (error) {
    console.error("Erro em /dashboard/graficos/status-pedidos:", error);
    return res.status(500).json({ erro: "Erro ao carregar status de pedidos", detalhes: error.message });
  }
});

routerDashboard.get("/graficos/taxa-acuracia-semanal", async (req, res) => {
  try {
    const dataInicio = req.query.dataInicio || "2026-04-27";
    const dataFim = req.query.dataFim || new Date().toISOString().split('T')[0];
    
    // Acurácia corrigida: comparar quantidade_separada vs quantidade_solicitada
    // Usa data_separacao (data real do picking), ignorando dados anteriores ao início operacional
    const result = await pool.query(
      `
      SELECT
        TO_CHAR(date_trunc('week', data_separacao), 'IYYY-"W"IW') AS semana,
        TO_CHAR(date_trunc('week', data_separacao), 'DD/MM/YYYY') AS semana_label,
        COUNT(*)::int AS total_itens,
        ROUND(
          AVG(
            CASE
              WHEN COALESCE(quantidade_solicitada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_separada, 0) >= COALESCE(quantidade_solicitada, 0) THEN 100
              ELSE ROUND((COALESCE(quantidade_separada, 0) * 100.0 / NULLIF(quantidade_solicitada, 0))::numeric, 1)
            END
          ),
          2
        ) AS acuracia,
        ROUND(
          COUNT(*) FILTER (
            WHERE COALESCE(quantidade_separada, 0) < COALESCE(quantidade_solicitada, 0)
              AND COALESCE(quantidade_solicitada, 0) > 0
          ) * 100.0 / NULLIF(COUNT(*), 0),
          1
        ) AS taxa_divergencia
      FROM separacao_itens
      WHERE data_separacao IS NOT NULL
        AND data_separacao::date >= $1::date
        AND data_separacao::date <= $2::date
      GROUP BY date_trunc('week', data_separacao)
      ORDER BY date_trunc('week', data_separacao)
      `
    ,
      [dataInicio, dataFim]
    );

    return res.json(result.rows.map((r) => ({
      semana: r.semana_label || r.semana,
      acuracia: Number(r.acuracia || 0),
      totalItens: Number(r.total_itens || 0),
      taxaDivergencia: Number(r.taxa_divergencia || 0),
    })));
  } catch (error) {
    console.error("Erro em /dashboard/graficos/taxa-acuracia-semanal:", error);
    return res.status(500).json({ erro: "Erro ao carregar acuracia semanal", detalhes: error.message });
  }
});

routerDashboard.get("/graficos/heatmap-localizacao", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        COALESCE(id_posicao, 0) AS id_posicao,
        COUNT(*)::int AS picking_count
      FROM separacao_itens
      WHERE created_at::date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY id_posicao
      ORDER BY picking_count DESC
      LIMIT 30
      `
    );

    const maxCount = Math.max(1, ...result.rows.map((r) => Number(r.picking_count || 0)));
    const data = result.rows.map((r) => {
      const ratio = Number(r.picking_count || 0) / maxCount;
      let cor = "green";
      if (ratio >= 0.66) cor = "red";
      else if (ratio >= 0.33) cor = "orange";

      return {
        rua: "POS",
        modulo: String(r.id_posicao),
        picking_count: Number(r.picking_count || 0),
        cor,
      };
    });

    return res.json(data);
  } catch (error) {
    console.error("Erro em /dashboard/graficos/heatmap-localizacao:", error);
    return res.status(500).json({ erro: "Erro ao carregar heatmap", detalhes: error.message });
  }
});

routerDashboard.get("/metricas/por-hora", async (req, res) => {
  try {
    const data = req.query.data ? new Date(req.query.data) : new Date();
    const dataRef = data.toISOString().slice(0, 10);

    const result = await pool.query(
      `
      SELECT
        EXTRACT(HOUR FROM created_at)::int AS hora,
        COUNT(*)::int AS itens,
        ROUND(
          AVG(
            CASE
              WHEN COALESCE(quantidade_separada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_conferida, 0) >= COALESCE(quantidade_separada, 0) THEN 100
              ELSE (COALESCE(quantidade_conferida, 0) * 100.0 / NULLIF(quantidade_separada, 0))
            END
          ),
          2
        ) AS acuracia,
        COUNT(*) FILTER (
          WHERE COALESCE(quantidade_conferida, 0) < COALESCE(quantidade_separada, 0)
            AND COALESCE(quantidade_separada, 0) > 0
        )::int AS erros,
        COUNT(DISTINCT id_operador_separacao)::int AS operadores
      FROM separacao_itens
      WHERE created_at::date = $1::date
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hora
      `,
      [dataRef]
    );

    return res.json(result.rows.map((r) => ({
      hora: Number(r.hora || 0),
      itens: Number(r.itens || 0),
      acuracia: Number(r.acuracia || 100),
      erros: Number(r.erros || 0),
      operadores: Number(r.operadores || 0),
    })));
  } catch (error) {
    console.error("Erro em /dashboard/metricas/por-hora:", error);
    return res.status(500).json({ erro: "Erro ao carregar metricas por hora", detalhes: error.message });
  }
});

routerDashboard.get("/metricas/por-dia", async (req, res) => {
  try {
    const mes = Number(req.query.mes || new Date().getMonth() + 1);
    const ano = Number(req.query.ano || new Date().getFullYear());

    const result = await pool.query(
      `
      SELECT
        TO_CHAR(created_at::date, 'YYYY-MM-DD') AS data,
        COUNT(*)::int AS itens,
        COUNT(DISTINCT id_separacao_pedido)::int AS pedidos,
        ROUND(
          AVG(
            CASE
              WHEN COALESCE(quantidade_separada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_conferida, 0) >= COALESCE(quantidade_separada, 0) THEN 100
              ELSE (COALESCE(quantidade_conferida, 0) * 100.0 / NULLIF(quantidade_separada, 0))
            END
          ),
          2
        ) AS acuracia,
        ROUND(
          COUNT(*)::numeric /
          NULLIF(
            SUM(
              GREATEST(
                EXTRACT(EPOCH FROM (COALESCE(updated_at, NOW()) - COALESCE(data_separacao, created_at))) / 3600,
                0.05
              )
            ),
            0
          ),
          1
        ) AS picking_rate,
        COUNT(*) FILTER (
          WHERE COALESCE(quantidade_conferida, 0) < COALESCE(quantidade_separada, 0)
            AND COALESCE(quantidade_separada, 0) > 0
        )::int AS erros
      FROM separacao_itens
      WHERE EXTRACT(MONTH FROM created_at) = $1
        AND EXTRACT(YEAR FROM created_at) = $2
      GROUP BY created_at::date
      ORDER BY created_at::date
      `,
      [mes, ano]
    );

    return res.json(result.rows.map((r) => ({
      data: r.data,
      itens: Number(r.itens || 0),
      pedidos: Number(r.pedidos || 0),
      acuracia: Number(r.acuracia || 100),
      picking_rate: Number(r.picking_rate || 0),
      erros: Number(r.erros || 0),
    })));
  } catch (error) {
    console.error("Erro em /dashboard/metricas/por-dia:", error);
    return res.status(500).json({ erro: "Erro ao carregar metricas por dia", detalhes: error.message });
  }
});

routerDashboard.get("/erros/frequentes", async (req, res) => {
  try {
    const { inicio, fim } = parsePeriodoDashboard(req.query.dataInicio, req.query.dataFim);
    const limite = Math.max(1, Math.min(Number(req.query.limite || 10), 30));

    const result = await pool.query(
      `
      SELECT
        tipo,
        COUNT(*)::int AS count,
        ROUND((COUNT(*) * 100.0 / NULLIF(SUM(COUNT(*)) OVER(), 0)), 2) AS percentual
      FROM (
        SELECT
          CASE
            WHEN COALESCE(quantidade_separada, 0) > 0 AND COALESCE(quantidade_conferida, 0) < COALESCE(quantidade_separada, 0) THEN 'QUANTIDADE'
            WHEN id_posicao IS NULL THEN 'POSICAO'
            WHEN status = 'CANCELADO' THEN 'PRODUTO'
            ELSE 'DIVERGENCIA'
          END AS tipo
        FROM separacao_itens
        WHERE created_at::date BETWEEN $1::date AND $2::date
      ) t
      GROUP BY tipo
      ORDER BY count DESC
      LIMIT $3
      `,
      [inicio, fim, limite]
    );

    return res.json(result.rows.map((r) => ({
      tipo: r.tipo,
      count: Number(r.count || 0),
      percentual: Number(r.percentual || 0),
    })));
  } catch (error) {
    console.error("Erro em /dashboard/erros/frequentes:", error);
    return res.status(500).json({ erro: "Erro ao carregar erros frequentes", detalhes: error.message });
  }
});

routerDashboard.get("/metricas/tendencias", async (req, res) => {
  try {
    const meses = Math.max(3, Math.min(Number(req.query.meses || 6), 24));

    const result = await pool.query(
      `
      SELECT
        TO_CHAR(date_trunc('month', data_separacao), 'MM/YYYY') AS mes,
        COUNT(*)::int AS itens,
        ROUND(
          AVG(
            CASE
              WHEN COALESCE(quantidade_solicitada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_separada, 0) >= COALESCE(quantidade_solicitada, 0) THEN 100
              ELSE ROUND((COALESCE(quantidade_separada, 0) * 100.0 / NULLIF(quantidade_solicitada, 0))::numeric, 1)
            END
          ),
          2
        ) AS acuracia,
        ROUND(
          COUNT(*)::numeric / NULLIF(COUNT(DISTINCT id_operador_separacao) * COUNT(DISTINCT data_separacao::date) * 8.0, 0),
          1
        ) AS picking_rate,
        date_trunc('month', data_separacao) AS mes_data
      FROM separacao_itens
      WHERE data_separacao IS NOT NULL
        AND data_separacao >= date_trunc('month', CURRENT_DATE) - (($1 - 1) * INTERVAL '1 month')
        AND data_separacao >= $2::date
      GROUP BY date_trunc('month', data_separacao)
      ORDER BY mes_data
      `,
      [meses, DASHBOARD_SEPARACAO_DATA_INICIAL]
    );

    const data = result.rows.map((r, i, arr) => {
      let tendencia = "→";
      if (i > 0) {
        const atual = Number(r.itens || 0);
        const anterior = Number(arr[i - 1].itens || 0);
        if (atual > anterior) tendencia = "↑";
        else if (atual < anterior) tendencia = "↓";
      }
      return {
        mes: r.mes,
        itens: Number(r.itens || 0),
        acuracia: Number(r.acuracia || 0),
        picking_rate: Number(r.picking_rate || 0),
        tendencia,
      };
    });

    return res.json(data);
  } catch (error) {
    console.error("Erro em /dashboard/metricas/tendencias:", error);
    return res.status(500).json({ erro: "Erro ao carregar tendencias", detalhes: error.message });
  }
});

// Novo endpoint: Divergências diárias (itens com quantidade separada < solicitada)
routerDashboard.get("/graficos/divergencias-por-dia", async (req, res) => {
  try {
    const dataInicio = req.query.dataInicio || "2026-04-27";
    const dataFim = req.query.dataFim || new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      `
      SELECT
        TO_CHAR(data_separacao::date, 'YYYY-MM-DD') AS data,
        COUNT(*)::int AS total_separados,
        COUNT(*) FILTER (
          WHERE COALESCE(quantidade_separada, 0) < COALESCE(quantidade_solicitada, 0)
            AND COALESCE(quantidade_solicitada, 0) > 0
        )::int AS divergentes,
        COUNT(*) FILTER (
          WHERE COALESCE(quantidade_separada, 0) >= COALESCE(quantidade_solicitada, 0)
            AND COALESCE(quantidade_solicitada, 0) > 0
        )::int AS corretos,
        ROUND(
          COUNT(*) FILTER (
            WHERE COALESCE(quantidade_separada, 0) < COALESCE(quantidade_solicitada, 0)
              AND COALESCE(quantidade_solicitada, 0) > 0
          ) * 100.0 / NULLIF(COUNT(*), 0),
          1
        ) AS taxa_divergencia
      FROM separacao_itens
      WHERE data_separacao IS NOT NULL
        AND data_separacao::date >= $1::date
        AND data_separacao::date <= $2::date
      GROUP BY data_separacao::date
      ORDER BY data_separacao::date
      `
    ,
      [dataInicio, dataFim]
    );

    return res.json(result.rows.map((r) => ({
      data: r.data,
      totalSeparados: Number(r.total_separados || 0),
      divergentes: Number(r.divergentes || 0),
      corretos: Number(r.corretos || 0),
      taxaDivergencia: Number(r.taxa_divergencia || 0),
    })));
  } catch (error) {
    console.error("Erro em /dashboard/graficos/divergencias-por-dia:", error);
    return res.status(500).json({ erro: "Erro ao carregar divergencias", detalhes: error.message });
  }
});

routerDashboard.get("/export", async (req, res) => {
  try {
    const { inicio, fim } = parsePeriodoDashboard(req.query.dataInicio, req.query.dataFim);
    const inicioEfetivo = inicio;
    const formato = (req.query.formato || "excel").toString();

    const result = await pool.query(
      `
      SELECT
        TO_CHAR(data_separacao::date, 'YYYY-MM-DD') AS data,
        COUNT(*)::int AS itens,
        COUNT(DISTINCT id_separacao_pedido)::int AS pedidos,
        ROUND(
          AVG(
            CASE
              WHEN COALESCE(quantidade_solicitada, 0) <= 0 THEN 100
              WHEN COALESCE(quantidade_separada, 0) >= COALESCE(quantidade_solicitada, 0) THEN 100
              ELSE ROUND((COALESCE(quantidade_separada, 0) * 100.0 / NULLIF(quantidade_solicitada, 0))::numeric, 1)
            END
          ),
          2
        ) AS acuracia
      FROM separacao_itens
      WHERE data_separacao IS NOT NULL
        AND data_separacao::date BETWEEN $1::date AND $2::date
      GROUP BY data_separacao::date
      ORDER BY data_separacao::date
      `,
      [inicioEfetivo, fim]
    );

    if (formato === "excel") {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Dashboard Separacao");

      sheet.columns = [
        { header: "Data", key: "data", width: 14 },
        { header: "Itens", key: "itens", width: 12 },
        { header: "Pedidos", key: "pedidos", width: 12 },
        { header: "Acuracia (%)", key: "acuracia", width: 16 },
      ];

      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { horizontal: "center" };

      result.rows.forEach((r) => {
        sheet.addRow({
          data: r.data,
          itens: Number(r.itens || 0),
          pedidos: Number(r.pedidos || 0),
          acuracia: Number(r.acuracia || 100),
        });
      });

      const totalItens = result.rows.reduce((acc, r) => acc + Number(r.itens || 0), 0);
      const totalPedidos = result.rows.reduce((acc, r) => acc + Number(r.pedidos || 0), 0);
      const mediaAcuracia = result.rows.length
        ? result.rows.reduce((acc, r) => acc + Number(r.acuracia || 100), 0) / result.rows.length
        : 100;

      const totalRow = sheet.addRow({
        data: "TOTAL/MEDIA",
        itens: totalItens,
        pedidos: totalPedidos,
        acuracia: Number(mediaAcuracia.toFixed(2)),
      });
      totalRow.font = { bold: true };
      totalRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE3F2FD" },
      };

      const buffer = await workbook.xlsx.writeBuffer();
      const nome = `dashboard-separacao-${inicio}-a-${fim}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename=${nome}`);
      return res.send(Buffer.from(buffer));
    }

    if (formato === "pdf") {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks = [];

      const pdfBuffer = await new Promise((resolve, reject) => {
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        doc.fontSize(16).text("Dashboard Separacao de Pedidos", { align: "center" });
        doc.moveDown(0.5);
        doc.fontSize(10).text(`Periodo: ${inicio} a ${fim}`, { align: "center" });
        doc.moveDown(1);

        doc.fontSize(10).text("Data", 40, doc.y, { width: 100 });
        doc.text("Itens", 150, doc.y - 12, { width: 80, align: "right" });
        doc.text("Pedidos", 250, doc.y - 12, { width: 80, align: "right" });
        doc.text("Acuracia (%)", 350, doc.y - 12, { width: 120, align: "right" });
        doc.moveTo(40, doc.y + 2).lineTo(550, doc.y + 2).stroke();
        doc.moveDown(0.6);

        let y = doc.y;
        result.rows.forEach((r) => {
          if (y > 760) {
            doc.addPage();
            y = 40;
          }
          doc.text(String(r.data), 40, y, { width: 100 });
          doc.text(String(Number(r.itens || 0)), 150, y, { width: 80, align: "right" });
          doc.text(String(Number(r.pedidos || 0)), 250, y, { width: 80, align: "right" });
          doc.text(String(Number(r.acuracia || 100).toFixed(2)), 350, y, { width: 120, align: "right" });
          y += 18;
        });

        const totalItens = result.rows.reduce((acc, r) => acc + Number(r.itens || 0), 0);
        const totalPedidos = result.rows.reduce((acc, r) => acc + Number(r.pedidos || 0), 0);
        const mediaAcuracia = result.rows.length
          ? result.rows.reduce((acc, r) => acc + Number(r.acuracia || 100), 0) / result.rows.length
          : 100;

        y += 8;
        doc.moveTo(40, y).lineTo(550, y).stroke();
        y += 8;
        doc.font("Helvetica-Bold");
        doc.text("TOTAL/MEDIA", 40, y, { width: 100 });
        doc.text(String(totalItens), 150, y, { width: 80, align: "right" });
        doc.text(String(totalPedidos), 250, y, { width: 80, align: "right" });
        doc.text(String(Number(mediaAcuracia).toFixed(2)), 350, y, { width: 120, align: "right" });
        doc.font("Helvetica");

        doc.end();
      });

      const nome = `dashboard-separacao-${inicio}-a-${fim}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=${nome}`);
      return res.send(pdfBuffer);
    }

    // Fallback CSV para formatos desconhecidos
    const cabecalho = "data,itens,pedidos,acuracia\n";
    const linhas = result.rows
      .map((r) => `${r.data},${Number(r.itens || 0)},${Number(r.pedidos || 0)},${Number(r.acuracia || 100)}`)
      .join("\n");
    const csv = `${cabecalho}${linhas}`;
    const nome = `dashboard-separacao-${inicio}-a-${fim}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${nome}`);
    return res.send(csv);
  } catch (error) {
    console.error("Erro em /dashboard/export:", error);
    return res.status(500).json({ erro: "Erro ao exportar dashboard", detalhes: error.message });
  }
});

// Registrar rotas principais
app.use("/dashboard", routerDashboard);
app.use("/separacao", routerSeparacao);

// =============================================
// ROTAS DE ENTRADA DE PRODUÇÃO NO ARMAZÉM
// =============================================

const routerEntradaProducao = express.Router();
const OPERADORES_SAIDA_PERMITIDOS = [140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152];
const TEMPO_EXPIRACAO_EM_RECEBIMENTO_MINUTOS = 8;
const INTERVALO_AUTO_FINALIZACAO_MINUTOS = 2;
const OPERADOR_SISTEMA_AUTO_FINALIZACAO = 1;
let idsLiberadosPorTimeout = {}; // Armazena IDs liberados para exibição visual
let ultimoResumoAutoFinalizacao = {
  executado_em: null,
  entradas_finalizadas: 0,
  movimentos_estoque: 0,
  erro: null,
};

async function liberarEntradasEmRecebimentoExpiradas(executor) {
  try {
    const query = `
      UPDATE entrada_producao
      SET
        status = 'PENDENTE',
        id_operador_recebimento = NULL,
        data_inicio_recebimento = NULL,
        foi_liberado_por_timeout = true,
        updated_at = NOW()
      WHERE status = 'EM_RECEBIMENTO'
        AND quantidade_recebida < quantidade_total
        AND (
          id_operador_recebimento IS NULL
          OR EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, data_inicio_recebimento, created_at))) > ($1::numeric * 60)
        )
      RETURNING id, kardexid, usuario_origem, data_kardex
    `;

    const resultado = await executor.query(query, [TEMPO_EXPIRACAO_EM_RECEBIMENTO_MINUTOS]);

    if (resultado.rowCount > 0) {
      const idsLiberados = resultado.rows.map(r => r.id);
      console.log(
        `🔄 [TIMEOUT] ⏰ ${resultado.rowCount} entrada(s) liberada(s) em background após ${TEMPO_EXPIRACAO_EM_RECEBIMENTO_MINUTOS} min inativo`
      );
      resultado.rows.forEach(row => {
        console.log(`   → ID ${row.id} (Kardex: ${row.kardexid}) - de ${row.usuario_origem}`);
        idsLiberadosPorTimeout[row.id] = {
          kardexid: row.kardexid,
          liberado_em: new Date(),
          usuario_origem: row.usuario_origem
        };
      });
    }

    return {
      quantidade: resultado.rowCount,
      ids: resultado.rows.map(r => ({ id: r.id, kardexid: r.kardexid }))
    };
  } catch (error) {
    console.error('❌ Erro ao liberar EM_RECEBIMENTO expiradas:', error.message);
    return { quantidade: 0, ids: [] };
  }
}

async function autoFinalizarEntradasCompletas() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inventarioResult = await client.query(`
      SELECT id
      FROM inventario
      ORDER BY id DESC
      LIMIT 1
    `);

    if (inventarioResult.rowCount === 0) {
      throw new Error('Nenhum inventário encontrado para auto-finalização');
    }

    const idInventario = inventarioResult.rows[0].id;

    const entradasResult = await client.query(`
      SELECT id, produtoid
      FROM entrada_producao
      WHERE status IN ('PENDENTE', 'EM_RECEBIMENTO')
        AND quantidade_recebida >= quantidade_total
      ORDER BY updated_at ASC NULLS LAST, id ASC
      FOR UPDATE SKIP LOCKED
    `);

    if (entradasResult.rowCount === 0) {
      await client.query('COMMIT');
      ultimoResumoAutoFinalizacao = {
        executado_em: new Date().toISOString(),
        entradas_finalizadas: 0,
        movimentos_estoque: 0,
        erro: null,
      };
      return ultimoResumoAutoFinalizacao;
    }

    let movimentosEstoque = 0;

    for (const entrada of entradasResult.rows) {
      const itensResult = await client.query(`
        SELECT id_posicao, SUM(quantidade_colocada)::numeric AS quantidade_colocada
        FROM entrada_producao_itens
        WHERE id_entrada_producao = $1
        GROUP BY id_posicao
      `, [entrada.id]);

      for (const item of itensResult.rows) {
        // Cada recebimento gera sua própria linha — design intencional para múltiplos kardex na mesma posição
        await client.query(`
          INSERT INTO contagem_estoque (
            id_posicao,
            id_produto,
            quantidade_pacotes,
            id_operador,
            id_inventario,
            id_local_estoque,
            local_estoque,
            data_contagem,
            data_hora
          )
          VALUES ($1, $2, $3, $4, $5, 1, 'expedicao', NOW(), NOW())
        `, [item.id_posicao, entrada.produtoid, item.quantidade_colocada, OPERADOR_SISTEMA_AUTO_FINALIZACAO, idInventario]);

        movimentosEstoque += 1;
      }

      await client.query(`
        UPDATE entrada_producao
        SET status = 'FINALIZADO',
            data_finalizacao = NOW(),
            updated_at = NOW(),
            id_operador_recebimento = COALESCE(id_operador_recebimento, $2)
        WHERE id = $1
      `, [entrada.id, OPERADOR_SISTEMA_AUTO_FINALIZACAO]);
    }

    await client.query('COMMIT');

    ultimoResumoAutoFinalizacao = {
      executado_em: new Date().toISOString(),
      entradas_finalizadas: entradasResult.rowCount,
      movimentos_estoque: movimentosEstoque,
      erro: null,
    };

    if (entradasResult.rowCount > 0) {
      console.log(`✅ [AUTO-FINALIZACAO] ${entradasResult.rowCount} entrada(s) finalizada(s) automaticamente`);
    }

    return ultimoResumoAutoFinalizacao;
  } catch (error) {
    await client.query('ROLLBACK');
    ultimoResumoAutoFinalizacao = {
      executado_em: new Date().toISOString(),
      entradas_finalizadas: 0,
      movimentos_estoque: 0,
      erro: error.message,
    };
    throw error;
  } finally {
    client.release();
  }
}

async function repararFuncaoProcessarSaidaKardex(client) {
  const sqlRepair = `
    CREATE OR REPLACE FUNCTION public.processar_saida_kardex(
      p_kardexid_entrada integer,
      p_kardexid_saida integer,
      p_quantidade_saida integer,
      p_usuarioid integer,
      p_dt_saida timestamp without time zone
    )
    RETURNS TABLE(
      sucesso boolean,
      mensagem character varying,
      entrada_id integer,
      quantidade_restante integer
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_entrada_id INT;
      v_quantidade_total INT;
      v_quantidade_recebida INT;
      v_quantidade_restante INT;
      v_log_existente RECORD;
      v_linhas_log INT;
    BEGIN
      -- Idempotencia: se a saida ja foi processada, nao processar novamente.
      SELECT id, kardexid_entrada_original
      INTO v_log_existente
      FROM entrada_producao_saidas_log
      WHERE kardexid_saida = p_kardexid_saida
        AND status = 'PROCESSADO'
      ORDER BY id DESC
      LIMIT 1;

      IF v_log_existente.id IS NOT NULL THEN
        SELECT id, quantidade_total, quantidade_recebida
        INTO v_entrada_id, v_quantidade_total, v_quantidade_recebida
        FROM entrada_producao
        WHERE kardexid = v_log_existente.kardexid_entrada_original
        ORDER BY id DESC
        LIMIT 1;

        IF v_entrada_id IS NOT NULL THEN
          v_quantidade_restante := COALESCE(v_quantidade_total, 0) - COALESCE(v_quantidade_recebida, 0);
        ELSE
          v_quantidade_restante := NULL;
        END IF;

        RETURN QUERY SELECT
          TRUE::BOOLEAN,
          'Saida ja processada anteriormente (idempotente)'::VARCHAR,
          v_entrada_id::INT,
          v_quantidade_restante::INT;
        RETURN;
      END IF;

      -- 1. Buscar entrada original pelo kardexid
      SELECT id, quantidade_total, quantidade_recebida
      INTO v_entrada_id, v_quantidade_total, v_quantidade_recebida
      FROM entrada_producao
      WHERE kardexid = p_kardexid_entrada
      ORDER BY id DESC
      LIMIT 1;

      -- Se nao encontrou entrada, registrar saida sem processamento (somente uma vez)
      IF v_entrada_id IS NULL THEN
        INSERT INTO entrada_producao_saidas_log (
          kardexid_saida, kardexid_entrada_original, produtoid, quantidade_saida,
          usuarioid, dt_saida, status, observacoes
        )
        SELECT
          p_kardexid_saida, p_kardexid_entrada, NULL, ABS(p_quantidade_saida),
          p_usuarioid, p_dt_saida, 'PENDENTE', 'Entrada original nao encontrada - saida registrada'
        WHERE NOT EXISTS (
          SELECT 1 FROM entrada_producao_saidas_log WHERE kardexid_saida = p_kardexid_saida
        );

        RETURN QUERY SELECT
          TRUE::BOOLEAN,
          'Saida registrada mas entrada original nao encontrada'::VARCHAR,
          NULL::INT,
          NULL::INT;
        RETURN;
      END IF;

      -- 2. Calcular quantidade restante apos saida
      v_quantidade_restante := v_quantidade_total - ABS(p_quantidade_saida);

      -- 3. Atualizar entrada_producao
      UPDATE entrada_producao
      SET
        quantidade_removida = COALESCE(quantidade_removida, 0) + ABS(p_quantidade_saida),
        status_remocao = CASE
          WHEN (quantidade_total - (COALESCE(quantidade_removida, 0) + ABS(p_quantidade_saida))) <= 0 THEN 'COMPLETAMENTE_REMOVIDO'
          WHEN ABS(p_quantidade_saida) > 0 THEN 'PARCIALMENTE_REMOVIDO'
          ELSE 'ATIVO'
        END,
        updated_at = NOW()
      WHERE id = v_entrada_id;

      -- 4. Registrar no log de saidas sem duplicar kardexid_saida
      INSERT INTO entrada_producao_saidas_log (
        kardexid_saida, kardexid_entrada_original, produtoid, quantidade_saida,
        usuarioid, dt_saida, status
      )
      SELECT
        p_kardexid_saida, p_kardexid_entrada, NULL, ABS(p_quantidade_saida),
        p_usuarioid, p_dt_saida, 'PROCESSADO'
      WHERE NOT EXISTS (
        SELECT 1 FROM entrada_producao_saidas_log WHERE kardexid_saida = p_kardexid_saida
      );

      GET DIAGNOSTICS v_linhas_log = ROW_COUNT;

      IF v_linhas_log = 0 THEN
        RETURN QUERY SELECT
          TRUE::BOOLEAN,
          'Saida ja registrada no log (idempotente)'::VARCHAR,
          v_entrada_id::INT,
          v_quantidade_restante::INT;
        RETURN;
      END IF;

      -- 5. Se quantidade ficou <= 0, marcar como REMOVIDO
      IF v_quantidade_restante <= 0 THEN
        UPDATE entrada_producao
        SET status = 'REMOVIDO', status_remocao = 'COMPLETAMENTE_REMOVIDO'
        WHERE id = v_entrada_id;
      END IF;

      RETURN QUERY SELECT
        TRUE::BOOLEAN,
        'Saida processada com sucesso'::VARCHAR,
        v_entrada_id::INT,
        v_quantidade_restante::INT;
    END;
    $$;
  `;

  await client.query(sqlRepair);
}

async function garantirIdempotenciaSaidasKardex() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repararFuncaoProcessarSaidaKardex(client);
    await client.query('COMMIT');
    console.log('✅ Protecao anti-duplicidade de saidas kardex aplicada com sucesso.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.warn('⚠️ Nao foi possivel aplicar protecao anti-duplicidade de saidas kardex:', error.message);
  } finally {
    client.release();
  }
}

async function repararFuncaoSincronizarSaidasKardex(client) {
  const sqlRepair = `
    CREATE OR REPLACE FUNCTION public.sincronizar_saidas_kardex()
    RETURNS TABLE(processadas integer, erros integer, mensagem character varying)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_processadas INT := 0;
      v_erros INT := 0;
      v_saida RECORD;
    BEGIN
      FOR v_saida IN
        SELECT DISTINCT
          k1.kardexid::INT as kardexid_saida,
          k1.produtoid::INT as produtoid,
          k1.qt_kardex as quantidade_saida,
          k1.usuarioid::INT as usuarioid,
          k1.dt_kardex,
          k1.tipo_kerdex as tipo_kardex,
          (
            SELECT ep.kardexid
            FROM entrada_producao ep
            WHERE ep.produtoid = k1.produtoid::INT
              AND ep.usuario_origem = k1.usuarioid::INT
              AND ep.data_kardex < k1.dt_kardex
            ORDER BY ep.data_kardex DESC, ep.id DESC
            LIMIT 1
          )::INT as kardexid_entrada
        FROM (
          SELECT * FROM dblink(
            'hostaddr=192.168.10.252 port=5432 dbname=AWORKSDB user=postgres password=aw2000',
            'SELECT kardexid, produtoid, qt_kardex, usuarioid, dt_kardex, tipo_kerdex, Qt_estoque_total_kardex
             FROM kardex
             WHERE tipo_kerdex = ''SAIDA''
               AND usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
               AND dt_kardex >= NOW() - INTERVAL ''120 hours''
             ORDER BY dt_kardex DESC'
          ) AS k1(kardexid NUMERIC, produtoid NUMERIC, qt_kardex NUMERIC, usuarioid NUMERIC, dt_kardex TIMESTAMP, tipo_kerdex TEXT, Qt_estoque_total_kardex NUMERIC)
        ) k1
        WHERE NOT EXISTS (
          SELECT 1 FROM entrada_producao_saidas_log
          WHERE kardexid_saida = k1.kardexid::INT
        )
        AND EXISTS (
          SELECT 1
          FROM entrada_producao ep
          WHERE ep.kardexid = (
            SELECT ep2.kardexid
            FROM entrada_producao ep2
            WHERE ep2.produtoid = k1.produtoid::INT
              AND ep2.usuario_origem = k1.usuarioid::INT
              AND ep2.data_kardex < k1.dt_kardex
            ORDER BY ep2.data_kardex DESC, ep2.id DESC
            LIMIT 1
          )
        )
      LOOP
        BEGIN
          PERFORM processar_saida_kardex(
            v_saida.kardexid_entrada,
            v_saida.kardexid_saida,
            ABS(v_saida.quantidade_saida)::INT,
            v_saida.usuarioid,
            v_saida.dt_kardex
          );
          v_processadas := v_processadas + 1;
        EXCEPTION WHEN OTHERS THEN
          v_erros := v_erros + 1;
          RAISE NOTICE 'Erro ao processar saida kardex %: %', v_saida.kardexid_saida, SQLERRM;
        END;
      END LOOP;

      RETURN QUERY
      SELECT v_processadas::INT, v_erros::INT, 'Sincronizacao de saidas concluida'::VARCHAR;
    END;
    $$;
  `;

  await client.query(sqlRepair);
}

function precisaRepararSincronizarSaidas(msg) {
  const texto = String(msg || '');
  return (
    texto.includes('k1.tipo_kardex') ||
    texto.includes('não existe a relação "kardex"') ||
    texto.includes('relation "kardex" does not exist')
  );
}

async function repararSincronizarSaidasGlobal() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await repararFuncaoSincronizarSaidasKardex(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

garantirIdempotenciaSaidasKardex();

async function preencherProdutoIdLogsSaidas(executor) {
  const updateProdutoLogQuery = `
    UPDATE entrada_producao_saidas_log esl
    SET produtoid = ep.produtoid
    FROM entrada_producao ep
    WHERE esl.produtoid IS NULL
      AND esl.kardexid_entrada_original = ep.kardexid
  `;

  const resultado = await executor.query(updateProdutoLogQuery);

  if (resultado.rowCount > 0) {
    console.log(`✅ [SAIDAS_LOG] produtoid preenchido em ${resultado.rowCount} registro(s)`);
  }

  return resultado.rowCount;
}

async function validarProdutoSaidaContraEntrada(executor, kardexidEntrada, kardexidSaida) {
  const entradaResult = await executor.query(
    `SELECT kardexid, produtoid FROM entrada_producao WHERE kardexid = $1 ORDER BY id DESC LIMIT 1`,
    [kardexidEntrada]
  );

  if (entradaResult.rowCount === 0) {
    return {
      valido: false,
      motivo: 'Entrada original não encontrada para validar produto',
    };
  }

  const saidaResult = await executor.query(
    `SELECT kardexid, produtoid, tipo_kardex
     FROM vw_entradas_producao_aworks
     WHERE kardexid = $1
     ORDER BY dt_kardex DESC
     LIMIT 1`,
    [kardexidSaida]
  );

  if (saidaResult.rowCount === 0) {
    return {
      valido: false,
      motivo: 'Saída não encontrada na view AWORKS para validar produto',
    };
  }

  const entrada = entradaResult.rows[0];
  const saida = saidaResult.rows[0];

  if (saida.tipo_kardex !== 'SAIDA') {
    return {
      valido: false,
      motivo: 'Kardex informado não é uma saída válida',
    };
  }

  if (Number(entrada.produtoid) !== Number(saida.produtoid)) {
    return {
      valido: false,
      motivo: `Produto divergente entre entrada (${entrada.produtoid}) e saída (${saida.produtoid})`,
      entradaProdutoId: Number(entrada.produtoid),
      saidaProdutoId: Number(saida.produtoid),
    };
  }

  return {
    valido: true,
    entradaProdutoId: Number(entrada.produtoid),
    saidaProdutoId: Number(saida.produtoid),
  };
}

// 1. LISTAR ENTRADAS DO AWORKS
routerEntradaProducao.get("/aworks", autenticarToken, async (req, res) => {
  try {
    console.log("🔍 Buscando entradas de produção do AWORKS");

    await pool.query("SELECT atualizar_entradas_aworks()");
    try {
      await pool.query("SELECT * FROM sincronizar_saidas_kardex()");
      await preencherProdutoIdLogsSaidas(pool);
    } catch (syncError) {
      const msg = String(syncError?.message || '');
      if (precisaRepararSincronizarSaidas(msg)) {
        console.warn('⚠️ Função sincronizar_saidas_kardex desatualizada. Aplicando reparo automático...');
        try {
          await repararSincronizarSaidasGlobal();
          await pool.query("SELECT * FROM sincronizar_saidas_kardex()");
          await preencherProdutoIdLogsSaidas(pool);
          console.log('✅ Função sincronizar_saidas_kardex reparada e sincronização executada.');
        } catch (repairError) {
          console.warn('⚠️ Falha ao reparar sincronizar_saidas_kardex (seguindo sem sync):', repairError.message);
        }
      } else {
        console.warn("⚠️ Não foi possível sincronizar saídas antes da listagem:", msg);
      }
    }

    const query = `
      WITH movimentos_aworks AS (
        SELECT
          v.kardexid,
          v.produtoid,
          v.qt_kardex,
          v.tipo_kardex,
          v.usuarioid,
          v.dt_kardex,
          v.referencia_produto,
          v.ds_produto,
          v.operador_nome,
          ABS(v.qt_kardex) AS qt_absoluta,
          ROW_NUMBER() OVER (
            PARTITION BY v.produtoid, v.usuarioid, ABS(v.qt_kardex), v.tipo_kardex
            ORDER BY v.dt_kardex DESC, v.kardexid DESC
          ) AS rn_tipo
        FROM vw_entradas_producao_aworks v
      ),
      entradas_aworks_disponiveis AS (
        SELECT e.*
        FROM movimentos_aworks e
        LEFT JOIN movimentos_aworks s
          ON s.tipo_kardex = 'SAIDA'
          AND e.tipo_kardex = 'ENTRADA'
          AND s.produtoid = e.produtoid
          AND s.usuarioid = e.usuarioid
          AND s.qt_absoluta = e.qt_absoluta
          AND s.rn_tipo = e.rn_tipo
          AND s.dt_kardex > e.dt_kardex
        WHERE e.tipo_kardex = 'ENTRADA'
          AND s.kardexid IS NULL
      )
      SELECT
        v.kardexid,
        v.produtoid,
        v.qt_kardex,
        v.tipo_kardex,
        v.usuarioid,
        v.dt_kardex,
        v.referencia_produto,
        v.ds_produto as descricao_produto,
        v.operador_nome
      FROM entradas_aworks_disponiveis v
      WHERE NOT EXISTS (
        SELECT 1 FROM entrada_producao WHERE kardexid = v.kardexid AND produtoid = v.produtoid
      )
      ORDER BY v.dt_kardex DESC
    `;

    const resultado = await pool.query(query);
    res.json(resultado.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar entradas AWORKS:", error);
    res.status(500).json({ erro: "Erro ao buscar entradas" });
  }
});

// 2. LISTAR ENTRADAS PENDENTES (Últimas 24 horas - Criadas + AWORKS)
routerEntradaProducao.get("/pendentes", autenticarToken, async (req, res) => {
  try {
    await liberarEntradasEmRecebimentoExpiradas(pool);

    try {
      await pool.query("SELECT atualizar_entradas_aworks()");
      await pool.query("SELECT * FROM sincronizar_saidas_kardex()");
      await preencherProdutoIdLogsSaidas(pool);
    } catch (syncError) {
      const msg = String(syncError?.message || '');
      if (precisaRepararSincronizarSaidas(msg)) {
        console.warn('⚠️ Função sincronizar_saidas_kardex desatualizada. Aplicando reparo automático...');
        try {
          await repararSincronizarSaidasGlobal();
          await pool.query("SELECT * FROM sincronizar_saidas_kardex()");
          await preencherProdutoIdLogsSaidas(pool);
          console.log('✅ Função sincronizar_saidas_kardex reparada e sincronização executada.');
        } catch (repairError) {
          console.warn('⚠️ Falha ao reparar sincronizar_saidas_kardex (seguindo sem sync):', repairError.message);
        }
      } else {
        console.warn("⚠️ Erro ao sincronizar view/saídas para pendentes:", msg);
      }
    }

    const query = `
      WITH movimentos_aworks AS (
        SELECT
          v.kardexid,
          v.produtoid,
          v.qt_kardex,
          v.tipo_kardex,
          v.usuarioid,
          v.dt_kardex,
          v.referencia_produto,
          v.ds_produto,
          ABS(v.qt_kardex) AS qt_absoluta,
          ROW_NUMBER() OVER (
            PARTITION BY v.produtoid, v.usuarioid, ABS(v.qt_kardex), v.tipo_kardex
            ORDER BY v.dt_kardex DESC, v.kardexid DESC
          ) AS rn_tipo
        FROM vw_entradas_producao_aworks v
      ),
      entradas_aworks_disponiveis AS (
        SELECT e.*
        FROM movimentos_aworks e
        LEFT JOIN movimentos_aworks s
          ON s.tipo_kardex = 'SAIDA'
          AND e.tipo_kardex = 'ENTRADA'
          AND s.produtoid = e.produtoid
          AND s.usuarioid = e.usuarioid
          AND s.qt_absoluta = e.qt_absoluta
          AND s.rn_tipo = e.rn_tipo
          AND s.dt_kardex > e.dt_kardex
        WHERE e.tipo_kardex = 'ENTRADA'
          AND s.kardexid IS NULL
      )
      -- Entradas já criadas em entrada_producao que ainda não foram totalmente alocadas
      SELECT 
        ep.id,
        ep.kardexid,
        ep.produtoid,
        ep.quantidade_total,
        ep.quantidade_recebida,
        (ep.quantidade_total - ep.quantidade_recebida) as quantidade_pendente,
        ep.status,
        ep.data_kardex,
        p.referencia_produto,
        p.ds_produto as descricao_produto,
        COALESCE(pe.ean14, '') as ean14,
        (SELECT COALESCE(SUM(quantidade_colocada), 0) FROM entrada_producao_itens WHERE id_entrada_producao = ep.id) as total_posicoes,
        'criada' as origem,
        COALESCE(ep.foi_liberado_por_timeout, false) as foi_liberado_por_timeout,
        CASE WHEN COALESCE(ep.foi_liberado_por_timeout, false) = true THEN '⏰ Retornado por timeout' ELSE NULL END as aviso_timeout
      FROM entrada_producao ep
      LEFT JOIN produtos p ON ep.produtoid = p.id_cache
      LEFT JOIN LATERAL (
        SELECT pe.ean14
        FROM produtos_ean14 pe
        WHERE pe.id_produto = ep.produtoid
        ORDER BY pe.id ASC
        LIMIT 1
      ) pe ON true
      WHERE ep.quantidade_recebida < ep.quantidade_total
      AND COALESCE(ep.status, 'PENDENTE') IN ('PENDENTE', 'EM_RECEBIMENTO')
      AND NOT EXISTS (
        SELECT 1
        FROM entrada_producao_saidas_log esl
        WHERE esl.kardexid_entrada_original = ep.kardexid
          AND esl.usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
      )
      
      UNION ALL
      
      -- Entradas do AWORKS que ainda não foram criadas
      SELECT 
        NULL::integer as id,
        vaw.kardexid,
        vaw.produtoid,
        vaw.qt_kardex::integer as quantidade_total,
        0 as quantidade_recebida,
        vaw.qt_kardex::integer as quantidade_pendente,
        'PENDENTE' as status,
        vaw.dt_kardex as data_kardex,
        vaw.referencia_produto,
        vaw.ds_produto,
        COALESCE(pe.ean14, '') as ean14,
        0 as total_posicoes,
        'aworks' as origem,
        false as foi_liberado_por_timeout,
        NULL as aviso_timeout
      FROM entradas_aworks_disponiveis vaw
      LEFT JOIN LATERAL (
        SELECT pe.ean14
        FROM produtos_ean14 pe
        WHERE pe.id_produto = vaw.produtoid
        ORDER BY pe.id ASC
        LIMIT 1
      ) pe ON true
      WHERE vaw.tipo_kardex = 'ENTRADA'
      AND NOT EXISTS (
        SELECT 1 FROM entrada_producao ep WHERE ep.kardexid = vaw.kardexid AND ep.produtoid = vaw.produtoid
      )
      
      ORDER BY data_kardex DESC
    `;

    const resultado = await pool.query(query);
    res.json(resultado.rows);
  } catch (error) {
    console.error("❌ Erro ao buscar entradas pendentes:", error);
    res.status(500).json({ erro: "Erro ao buscar entradas" });
  }
});

// 2.0 DESCARTAR ENTRADAS PENDENTES (OCULTAR DA FILA)
routerEntradaProducao.post('/descartar', autenticarToken, async (req, res) => {
  const client = await pool.connect();

  try {
    const { entradas } = req.body;

    if (!Array.isArray(entradas) || entradas.length === 0) {
      return res.status(400).json({ erro: 'Informe ao menos uma entrada para descartar' });
    }

    await client.query('BEGIN');

    let totalDescartadas = 0;
    let totalIgnoradas = 0;

    for (const entrada of entradas) {
      const kardexid = Number(entrada?.kardexid);
      const produtoid = Number(entrada?.produtoid);
      const quantidadeTotal = Number(entrada?.quantidade_total || entrada?.quantidade_pendente || 0);
      const dataKardex = entrada?.data_kardex || null;

      if (!Number.isFinite(kardexid) || !Number.isFinite(produtoid) || kardexid <= 0 || produtoid <= 0) {
        totalIgnoradas += 1;
        continue;
      }

      const updateAtivo = await client.query(
        `UPDATE entrada_producao
         SET
           status = 'DESCARTADO',
           quantidade_recebida = quantidade_total,
           data_finalizacao = NOW(),
           updated_at = NOW(),
           foi_liberado_por_timeout = false
         WHERE kardexid = $1
           AND produtoid = $2
           AND COALESCE(status, 'PENDENTE') IN ('PENDENTE', 'EM_RECEBIMENTO')`,
        [kardexid, produtoid]
      );

      if (updateAtivo.rowCount > 0) {
        totalDescartadas += updateAtivo.rowCount;
        continue;
      }

      const existeHistorico = await client.query(
        `SELECT 1
         FROM entrada_producao
         WHERE kardexid = $1
           AND produtoid = $2
         LIMIT 1`,
        [kardexid, produtoid]
      );

      if (existeHistorico.rowCount > 0) {
        totalIgnoradas += 1;
        continue;
      }

      await client.query(
        `INSERT INTO entrada_producao (
          kardexid,
          produtoid,
          quantidade_total,
          quantidade_recebida,
          status,
          usuario_origem,
          data_kardex,
          id_operador_recebimento,
          data_finalizacao,
          created_at,
          updated_at,
          foi_liberado_por_timeout
        ) VALUES ($1, $2, $3, $3, 'DESCARTADO', $4, $5, $4, NOW(), NOW(), NOW(), false)`,
        [
          kardexid,
          produtoid,
          Number.isFinite(quantidadeTotal) && quantidadeTotal > 0 ? quantidadeTotal : 0,
          req.user.id,
          dataKardex,
        ]
      );

      totalDescartadas += 1;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `${totalDescartadas} entrada(s) descartada(s) da fila`,
      descartadas: totalDescartadas,
      ignoradas: totalIgnoradas,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao descartar entradas pendentes:', error);
    res.status(500).json({ erro: 'Erro ao descartar entradas pendentes' });
  } finally {
    client.release();
  }
});

// 2.0.1 LIBERAR ITEM PENDENTE (retornar para fila)
routerEntradaProducao.patch('/pendentes/:id/liberar', autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    if (!Number.isFinite(Number(id))) {
      return res.status(400).json({ erro: 'ID inválido' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE entrada_producao
       SET
         status = 'PENDENTE',
         id_operador_recebimento = NULL,
         data_inicio_recebimento = NULL,
         foi_liberado_por_timeout = false,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Entrada não encontrada' });
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Entrada liberada para fila de pendentes',
      entrada: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao liberar entrada pendente:', error);
    return res.status(500).json({ erro: 'Erro ao liberar entrada pendente' });
  } finally {
    client.release();
  }
});

// 2.0.2 ENTRAR EM ESTOQUE (marcar como finalizado)
routerEntradaProducao.patch('/pendentes/:id/entrar-estoque', autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { observacoes } = req.body || {};

    if (!Number.isFinite(Number(id))) {
      return res.status(400).json({ erro: 'ID inválido' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE entrada_producao
       SET
         quantidade_recebida = quantidade_total,
         status = 'FINALIZADO',
         id_operador_recebimento = COALESCE(id_operador_recebimento, $2),
         data_inicio_recebimento = COALESCE(data_inicio_recebimento, NOW()),
         data_finalizacao = NOW(),
         observacoes = COALESCE(NULLIF($3, ''), observacoes),
         foi_liberado_por_timeout = false,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, req.user.id, observacoes || null]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Entrada não encontrada' });
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Entrada marcada como finalizada (entrada em estoque)',
      entrada: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao marcar entrada em estoque:', error);
    return res.status(500).json({ erro: 'Erro ao marcar entrada em estoque' });
  } finally {
    client.release();
  }
});

// 2.0.3 EXCLUIR ITEM PENDENTE
routerEntradaProducao.delete('/pendentes/:id', autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    if (!Number.isFinite(Number(id))) {
      return res.status(400).json({ erro: 'ID inválido' });
    }

    await client.query('BEGIN');

    const itensResult = await client.query(
      `DELETE FROM entrada_producao_itens
       WHERE id_entrada_producao = $1`,
      [id]
    );

    const entradaResult = await client.query(
      `DELETE FROM entrada_producao
       WHERE id = $1
       RETURNING id, kardexid, produtoid, quantidade_total, quantidade_recebida, status`,
      [id]
    );

    if (entradaResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Entrada não encontrada' });
    }

    await client.query('COMMIT');
    return res.json({
      success: true,
      message: 'Entrada pendente excluída com sucesso',
      entrada: entradaResult.rows[0],
      itens_excluidos: itensResult.rowCount || 0,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao excluir entrada pendente:', error);
    return res.status(500).json({ erro: 'Erro ao excluir entrada pendente' });
  } finally {
    client.release();
  }
});

// 2.1 ENDPOINT: Alertas de itens liberados por timeout
routerEntradaProducao.get("/liberados-por-timeout", autenticarToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        kardexid,
        produtoid,
        (quantidade_total - quantidade_recebida) as quantidade_pendente,
        usuario_origem,
        updated_at as liberado_em
      FROM entrada_producao
      WHERE foi_liberado_por_timeout = true
        AND updated_at > NOW() - INTERVAL '1 hour'
      ORDER BY updated_at DESC
      LIMIT 20
    `;
    
    const resultado = await pool.query(query);
    
    return res.json({
      total_liberados: resultado.rowCount,
      liberados: resultado.rows,
      aviso: resultado.rowCount > 0 
        ? `⏰ ${resultado.rowCount} entrada(s) foram retornadas à fila por expiração de timeout`
        : null
    });
  } catch (error) {
    console.error("❌ Erro ao buscar itens liberados por timeout:", error);
    res.status(500).json({ erro: "Erro ao buscar liberados" });
  }
});

// 2.2 ENDPOINT: Status operacional da fila de entrada
routerEntradaProducao.get("/status-operacional", autenticarToken, async (req, res) => {
  try {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDENTE')::int AS pendente,
        COUNT(*) FILTER (WHERE status = 'EM_RECEBIMENTO')::int AS em_recebimento,
        COUNT(*) FILTER (WHERE status IN ('PENDENTE', 'EM_RECEBIMENTO'))::int AS ativos,
        COUNT(*) FILTER (WHERE status = 'EM_RECEBIMENTO' AND quantidade_recebida >= quantidade_total)::int AS em_recebimento_completo,
        COUNT(*) FILTER (
          WHERE status = 'PENDENTE'
          AND NOT EXISTS (
            SELECT 1 FROM entrada_producao_itens epi WHERE epi.id_entrada_producao = entrada_producao.id
          )
        )::int AS pendente_sem_item,
        COALESCE(
          MAX(
            EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 60
          ) FILTER (WHERE status IN ('PENDENTE', 'EM_RECEBIMENTO')),
          0
        )::int AS idade_maxima_minutos
      FROM entrada_producao
    `;

    const resultado = await pool.query(query);
    const status = resultado.rows[0] || {};
    const ativos = Number(status.ativos || 0);

    const alerta =
      ativos > 0 &&
      (
        Number(status.em_recebimento_completo || 0) > 0 ||
        Number(status.idade_maxima_minutos || 0) >= 30
      );

    res.json({
      ...status,
      alerta,
      ultimo_auto_finalizacao: ultimoResumoAutoFinalizacao,
    });
  } catch (error) {
    console.error('❌ Erro ao buscar status operacional de entrada:', error);
    res.status(500).json({ erro: 'Erro ao buscar status operacional' });
  }
});

// 3. CRIAR NOVA ENTRADA
routerEntradaProducao.post("/", autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      kardexid,
      produtoid,
      quantidade_total,
      usuario_origem,
      data_kardex,
    } = req.body;

    console.log(`📝 Criando entrada para kardex ${kardexid}`);

    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [Number(kardexid), Number(produtoid)]);

    const checkEntradaExistenteQuery = `
      SELECT *
      FROM entrada_producao
      WHERE kardexid = $1 AND produtoid = $2
      ORDER BY id ASC
      LIMIT 1
    `;

    const checkEntradaExistenteResult = await client.query(checkEntradaExistenteQuery, [kardexid, produtoid]);

    if (checkEntradaExistenteResult.rows.length > 0) {
      await client.query("COMMIT");
      return res.json({
        success: true,
        already_existed: true,
        message: "Entrada já existia",
        entrada: checkEntradaExistenteResult.rows[0],
      });
    }

    const query = `
      INSERT INTO entrada_producao (
        kardexid,
        produtoid,
        quantidade_total,
        quantidade_recebida,
        status,
        usuario_origem,
        data_kardex,
        id_operador_recebimento,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, 0, 'PENDENTE', $4, $5, $6, NOW(), NOW())
      RETURNING *
    `;

    const resultado = await client.query(query, [
      kardexid,
      produtoid,
      quantidade_total,
      usuario_origem,
      data_kardex,
      req.user.id,
    ]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Entrada criada com sucesso",
      entrada: resultado.rows[0],
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("⚠️ Erro no rollback ao criar entrada:", rollbackError.message);
    }

    if (error.code === '23505' && error.constraint === 'idx_unique_entrada_prod_ativo_kardex_produto') {
      try {
        const entradaExistente = await pool.query(
          `SELECT *
           FROM entrada_producao
           WHERE kardexid = $1 AND produtoid = $2
           ORDER BY id ASC
           LIMIT 1`,
          [req.body.kardexid, req.body.produtoid]
        );

        if (entradaExistente.rows.length > 0) {
          return res.json({
            success: true,
            already_existed: true,
            message: 'Entrada já existia',
            entrada: entradaExistente.rows[0],
          });
        }
      } catch (lookupError) {
        console.error('⚠️ Falha ao consultar entrada existente após 23505:', lookupError.message);
      }
    }

    console.error("❌ Erro ao criar entrada:", error);
    res.status(500).json({ erro: "Erro ao criar entrada" });
  } finally {
    client.release();
  }
});

// 4. OBTER DETALHES DE UMA ENTRADA
routerEntradaProducao.get("/:id", autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;

    await liberarEntradasEmRecebimentoExpiradas(pool);

    const entradaQuery = `
      SELECT 
        ep.*,
        p.referencia_produto,
        p.ds_produto as descricao_produto
      FROM entrada_producao ep
      LEFT JOIN produtos p ON ep.produtoid = p.id_cache
      WHERE ep.id = $1
    `;

    const itensQuery = `
      SELECT 
        epi.id,
        epi.id_posicao,
        epi.quantidade_colocada,
        epi.data_colocacao,
        epi.observacoes,
        CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) as codigo_endereco,
        p.descricao as posicao_descricao
      FROM entrada_producao_itens epi
      LEFT JOIN posicoes p ON epi.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      WHERE epi.id_entrada_producao = $1
      ORDER BY epi.data_colocacao
    `;

    const entradaResult = await pool.query(entradaQuery, [id]);
    const itensResult = await pool.query(itensQuery, [id]);

    if (entradaResult.rows.length === 0) {
      return res.status(404).json({ erro: "Entrada não encontrada" });
    }

    res.json({
      entrada: {
        ...entradaResult.rows[0],
        quantidade_pendente: entradaResult.rows[0].quantidade_total - entradaResult.rows[0].quantidade_recebida
      },
      itens: itensResult.rows,
    });
  } catch (error) {
    console.error("❌ Erro ao obter detalhes:", error);
    res.status(500).json({ erro: "Erro ao obter detalhes" });
  }
});

// 5. ADICIONAR POSIÇÃO À ENTRADA
routerEntradaProducao.post("/:id/itens", autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { id } = req.params;
    let { id_posicao, quantidade_colocada } = req.body;

    console.log('📝 Dados recebidos no backend:', {
      id_entrada: id,
      id_posicao: id_posicao,
      id_posicao_tipo: typeof id_posicao,
      quantidade_colocada: quantidade_colocada,
      quantidade_tipo: typeof quantidade_colocada,
      body_completo: req.body
    });

    // Validar e converter id_posicao para inteiro
    id_posicao = parseInt(id_posicao, 10);
    if (isNaN(id_posicao) || id_posicao <= 0) {
      await client.query("ROLLBACK");
      console.error('❌ ID posição inválida:', id_posicao);
      return res.status(400).json({ erro: "ID da posição inválido" });
    }

    // Garantir que quantidade é um número inteiro válido
    quantidade_colocada = parseInt(quantidade_colocada, 10);
    
    if (isNaN(quantidade_colocada) || quantidade_colocada <= 0) {
      await client.query("ROLLBACK");
      console.error('❌ Quantidade inválida:', quantidade_colocada);
      return res.status(400).json({ erro: "Quantidade inválida ou menor que 1" });
    }

    console.log(`📦 Adicionando posição ${id_posicao} à entrada ${id} com quantidade ${quantidade_colocada}`);

    // Buscar entrada
    const entradaQuery = `SELECT * FROM entrada_producao WHERE id = $1`;
    const entradaResult = await client.query(entradaQuery, [id]);

    if (entradaResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Entrada não encontrada" });
    }

    const entrada = entradaResult.rows[0];

    // Validar quantidade
    if (entrada.quantidade_recebida + quantidade_colocada > entrada.quantidade_total) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        erro: "Quantidade excede o total da entrada",
      });
    }

    // Adicionar item
    const itemQuery = `
      INSERT INTO entrada_producao_itens (
        id_entrada_producao,
        id_posicao,
        quantidade_colocada,
        id_operador_posicao,
        data_colocacao,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      RETURNING *
    `;

    console.log(`📋 Query de inserção do item:`, {
      id_entrada: id,
      id_posicao: id_posicao,
      quantidade: quantidade_colocada,
      tipo_quantidade: typeof quantidade_colocada,
      id_operador: req.user.id
    });

    const itemResult = await client.query(itemQuery, [
      id,
      id_posicao,
      quantidade_colocada,
      req.user.id,
    ]);

    // Atualizar quantidade_recebida da entrada
    const atualizarQuery = `
      UPDATE entrada_producao 
      SET 
        quantidade_recebida = quantidade_recebida + $1,
        status = 'EM_RECEBIMENTO',
        id_operador_recebimento = $3,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const atualizarResult = await client.query(atualizarQuery, [
      quantidade_colocada,
      id,
      req.user.id,
    ]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Posição adicionada com sucesso",
      item: itemResult.rows[0],
      entrada: atualizarResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao adicionar item:", error);
    res.status(500).json({ erro: "Erro ao adicionar posição" });
  } finally {
    client.release();
  }
});

// 6. REMOVER ITEM DE UMA ENTRADA
routerEntradaProducao.delete(
  "/:id/itens/:itemId",
  autenticarToken,
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { id, itemId } = req.params;

      // Buscar item
      const itemQuery = `SELECT * FROM entrada_producao_itens WHERE id = $1`;
      const itemResult = await client.query(itemQuery, [itemId]);

      if (itemResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ erro: "Item não encontrado" });
      }

      const item = itemResult.rows[0];
      const quantidade = item.quantidade_colocada;

      // Deletar item
      await client.query(
        "DELETE FROM entrada_producao_itens WHERE id = $1",
        [itemId]
      );

      // Atualizar quantidade_recebida
      const atualizarQuery = `
        UPDATE entrada_producao 
        SET 
          quantidade_recebida = quantidade_recebida - $1,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;

      const atualizarResult = await client.query(atualizarQuery, [
        quantidade,
        id,
      ]);

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Item removido com sucesso",
        entrada: atualizarResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("❌ Erro ao remover item:", error);
      res.status(500).json({ erro: "Erro ao remover item" });
    } finally {
      client.release();
    }
  }
);

// 7. FINALIZAR ENTRADA (AUMENTAR ESTOQUE)
routerEntradaProducao.post("/:id/finalizar", autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { id } = req.params;

    console.log(`🏁 Finalizando entrada ${id}`);

    // Buscar entrada e bloquear a linha PRIMEIRO (antes de tocar contagem_estoque)
    // Isso garante ordem consistente de bloqueio: entrada_producao → contagem_estoque
    // evitando deadlock com o job de auto-finalização que faz o mesmo em sequência
    const entradaQuery = `SELECT * FROM entrada_producao WHERE id = $1 FOR UPDATE`;
    const entradaResult = await client.query(entradaQuery, [id]);

    if (entradaResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Entrada não encontrada" });
    }

    const entrada = entradaResult.rows[0];

    // Verificar se já foi finalizada por outro processo (auto-finalizer)
    if (entrada.status === 'FINALIZADO') {
      await client.query("ROLLBACK");
      return res.json({ success: true, message: "Entrada já finalizada", entrada });
    }

    console.log(`  📊 Entrada ${id}: recebida=${entrada.quantidade_recebida}, total=${entrada.quantidade_total}`);

    // Validar se há quantidade pendente
    if (entrada.quantidade_recebida < entrada.quantidade_total) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        erro: "Não pode finalizar com quantidade pendente",
        quantidade_recebida: entrada.quantidade_recebida,
        quantidade_total: entrada.quantidade_total,
        quantidade_pendente: entrada.quantidade_total - entrada.quantidade_recebida
      });
    }

    // Buscar itens para aumentar estoque
    const itensQuery = `
      SELECT epi.id_posicao, epi.quantidade_colocada
      FROM entrada_producao_itens epi
      WHERE epi.id_entrada_producao = $1
    `;

    const itensResult = await client.query(itensQuery, [id]);

    // Buscar o id_inventario MAIS RECENTE (último ID criado)
    // IMPORTANTE: Sempre usar O MESMO critério em todas as rotas
    const inventarioQuery = `
      SELECT id FROM inventario 
      ORDER BY id DESC 
      LIMIT 1
    `;
    const inventarioResult = await client.query(inventarioQuery);
    
    if (inventarioResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ erro: "Nenhum inventário encontrado no sistema" });
    }

    const id_inventario = inventarioResult.rows[0].id;
    
    console.log(`  📋 Usando inventário ID: ${id_inventario}`);

    // Atualizar estoque em contagem_estoque usando UPSERT
    for (const item of itensResult.rows) {
      const { id_posicao, quantidade_colocada } = item;

      console.log(
        `  📦 Aumentando estoque: posição ${id_posicao}, quantidade +${quantidade_colocada}, produto ${entrada.produtoid}, inventário ${id_inventario}`
      );

      // Cada recebimento gera sua própria linha — design intencional para múltiplos kardex na mesma posição
      console.log(`  ➕ Inserindo registro de estoque para posição ${id_posicao}`);
      const insertQuery = `
        INSERT INTO contagem_estoque (
          id_posicao, 
          id_produto, 
          quantidade_pacotes, 
          id_operador, 
          id_inventario,
          id_local_estoque,
          local_estoque,
          data_contagem,
          data_hora
        )
        VALUES ($1, $2, $3, $4, $5, 1, 'expedicao', NOW(), NOW())
      `;
      await client.query(insertQuery, [
        id_posicao,
        entrada.produtoid,
        quantidade_colocada,
        req.user.id,
        id_inventario
      ]);
      console.log(`  ✅ Registro inserido com sucesso`);
    }

    // Atualizar status da entrada para FINALIZADO
    const finalizarQuery = `
      UPDATE entrada_producao 
      SET 
        status = 'FINALIZADO',
        data_finalizacao = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const finalizarResult = await client.query(finalizarQuery, [id]);

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Entrada finalizada com sucesso",
      entrada: finalizarResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao finalizar entrada:", error);
    res.status(500).json({ erro: "Erro ao finalizar entrada" });
  } finally {
    client.release();
  }
});

// 8. VALIDAR CÓDIGO DE BARRAS DA POSIÇÃO
routerEntradaProducao.post("/validar-posicao", autenticarToken, async (req, res) => {
  try {
    const { codigo_barras } = req.body;

    const resultado = await pool.query(
      `SELECT 
        p.id AS id_posicao,
        p.codigo AS codigo_posicao,
        p.descricao AS descricao_posicao,
        p.codigo_barras,
        le.descricao AS local_estoque_descricao,
        le.id AS id_local_estoque
      FROM posicoes p
      INNER JOIN locais_estoque le ON p.id_local_estoque = le.id
      WHERE p.codigo_barras = $1 AND p.id_local_estoque = 1`,
      [codigo_barras]
    );

    if (resultado.rows.length === 0) {
      return res.status(404).json({ 
        valido: false, 
        erro: 'Código de barras não encontrado ou posição não é da EXPEDIÇÃO' 
      });
    }

    res.json({
      valido: true,
      posicao: resultado.rows[0]
    });

  } catch (error) {
    console.error('❌ Erro ao validar posição:', error);
    res.status(500).json({ erro: 'Erro ao validar código de barras da posição' });
  }
});

// 9. VALIDAR CÓDIGO DE BARRAS DO PRODUTO (EAN13/EAN14)
routerEntradaProducao.post("/validar-produto", autenticarToken, async (req, res) => {
  try {
    const { codigo_barras, id_cache } = req.body;

    let resultado;

    // Tentar buscar por EAN13 primeiro
    if (codigo_barras.length === 13) {
      resultado = await pool.query(
        `SELECT 
          pc.id AS id_cache,
          pc.referencia AS referencia_produto,
          pc.descricao AS descricao_produto,
          1 as quantidade_embalagem,
          'UNITÁRIO' as tipo_codigo,
          pc.ean13 as codigo_barras
        FROM produtos_cache pc
        WHERE pc.ean13 = $1`,
        [codigo_barras]
      );
    }
    // Buscar por EAN14
    else if (codigo_barras.length === 14) {
      resultado = await pool.query(
        `SELECT 
          pc.id AS id_cache,
          pc.referencia AS referencia_produto,
          pc.descricao AS descricao_produto,
          pe.quantidade as quantidade_embalagem,
          CASE 
            WHEN pe.ean14 LIKE '1%' THEN 'PACOTE'
            WHEN pe.ean14 LIKE '2%' THEN 'MASTER'
            ELSE 'MASTER_EXTRA'
          END as tipo_codigo,
          pe.ean14 as codigo_barras
        FROM produtos_ean14 pe
        INNER JOIN produtos_cache pc ON pe.id_produto = pc.id
        WHERE pe.ean14 = $1`,
        [codigo_barras]
      );
    }

    if (!resultado || resultado.rows.length === 0) {
      return res.status(404).json({ 
        encontrado: false, 
        erro: 'Código de barras não encontrado' 
      });
    }

    const produto = resultado.rows[0];

    // Verificar se é o produto correto
    if (id_cache && produto.id_cache !== id_cache) {
      return res.status(400).json({
        encontrado: true,
        produto_correto: false,
        produto_escaneado: produto,
        erro: 'Produto incorreto escaneado'
      });
    }

    res.json({
      encontrado: true,
      produto_correto: true,
      produto: produto
    });

  } catch (error) {
    console.error('❌ Erro ao validar produto:', error);
    res.status(500).json({ erro: 'Erro ao validar código de barras do produto' });
  }
});

// 10. LISTAR ENDEREÇOS DISPONÍVEIS PARA PRODUTO
routerEntradaProducao.get(
  "/enderecos/:idProduto",
  autenticarToken,
  async (req, res) => {
    try {
      const { idProduto } = req.params;

      const query = `
        SELECT 
          p.id as id_posicao,
          CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', p.codigo) as codigo_endereco,
          p.descricao as posicao_descricao,
          COALESCE(ce.quantidade_pacotes, 0) as quantidade_disponivel,
          le.descricao as local_estoque
        FROM posicoes p
        LEFT JOIN niveis n ON p.id_nivel = n.id
        LEFT JOIN modulos m ON n.id_modulo = m.id
        LEFT JOIN ruas r ON m.id_rua = r.id
        LEFT JOIN locais_estoque le ON p.id_local_estoque = le.id
        LEFT JOIN contagem_estoque ce ON p.id = ce.id_posicao AND ce.id_produto = $1
        WHERE p.id_local_estoque = 1
        ORDER BY r.codigo, m.codigo, n.codigo, p.codigo
        LIMIT 100
      `;

      const resultado = await pool.query(query, [idProduto]);
      res.json(resultado.rows);
    } catch (error) {
      console.error("❌ Erro ao buscar endereços:", error);
      res.status(500).json({ erro: "Erro ao buscar endereços" });
    }
  }
);

// 11. CRIAR ENTRADA DE PRODUÇÃO PARA AWORKS
routerEntradaProducao.post("/criar-aworks", autenticarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { kardexid, produtoid, quantidade_total, origem } = req.body;

    console.log(`📝 Criando entrada de produção para AWORKS - Kardex: ${kardexid}, Produto: ${produtoid}`);

    await client.query('BEGIN');

    // Travar por kardex/produto para impedir criação concorrente duplicada
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [Number(kardexid), Number(produtoid)]);

    // Verificar se já existe entrada com este kardexid/produto
    const checkQuery = `
      SELECT id FROM entrada_producao 
      WHERE kardexid = $1 AND produtoid = $2
      ORDER BY id ASC
      LIMIT 1
    `;

    const checkResult = await client.query(checkQuery, [kardexid, produtoid]);

    if (checkResult.rows.length > 0) {
      await client.query('COMMIT');
      console.log(`✅ Entrada já existe: ID ${checkResult.rows[0].id}`);
      return res.json({ id: checkResult.rows[0].id, already_existed: true });
    }

    // Criar nova entrada
    const insertQuery = `
      INSERT INTO entrada_producao (
        kardexid,
        produtoid,
        quantidade_total,
        quantidade_recebida,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, 0, 'PENDENTE', NOW(), NOW())
      RETURNING id
    `;

    const result = await client.query(insertQuery, [kardexid, produtoid, quantidade_total]);
    const novoId = result.rows[0].id;

    // Reprocessar saídas pendentes que dependiam desta entrada recém-criada.
    await client.query('SAVEPOINT sp_sync_saida_criar_aworks');
    try {
      await client.query("SELECT atualizar_entradas_aworks()");
      await client.query("SELECT * FROM sincronizar_saidas_kardex()");
      await preencherProdutoIdLogsSaidas(client);
      await client.query('RELEASE SAVEPOINT sp_sync_saida_criar_aworks');
    } catch (syncError) {
      await client.query('ROLLBACK TO SAVEPOINT sp_sync_saida_criar_aworks');
      const msg = String(syncError?.message || '');

      if (precisaRepararSincronizarSaidas(msg)) {
        console.warn('⚠️ Função sincronizar_saidas_kardex desatualizada durante criar-aworks. Aplicando reparo automático...');
        try {
          await repararFuncaoSincronizarSaidasKardex(client);
          await client.query("SELECT * FROM sincronizar_saidas_kardex()");
          await preencherProdutoIdLogsSaidas(client);
          console.log('✅ Reparo aplicado e saídas sincronizadas após criar entrada.');
        } catch (repairError) {
          await client.query('ROLLBACK TO SAVEPOINT sp_sync_saida_criar_aworks');
          console.warn('⚠️ Falha ao sincronizar saídas após criar-aworks (seguindo sem sync):', repairError.message);
        }
      } else {
        console.warn('⚠️ Erro ao sincronizar saídas após criar-aworks (seguindo sem sync):', msg);
      }

      await client.query('RELEASE SAVEPOINT sp_sync_saida_criar_aworks');
    }

    await client.query('COMMIT');

    console.log(`✅ Entrada criada com sucesso: ID ${novoId}`);

    res.json({ 
      id: novoId,
      kardexid,
      produtoid,
      quantidade_total,
      status: 'PENDENTE'
    });

  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('⚠️ Erro no rollback de criar-aworks:', rollbackError.message);
    }
    console.error('❌ Erro ao criar entrada:', error);
    res.status(500).json({ erro: 'Erro ao criar entrada de produção' });
  } finally {
    client.release();
  }
});

// 12. OBTER DADOS DO EAN14 PARA MONTAGEM DE PALLET
routerEntradaProducao.get("/ean14/:produtoid", autenticarToken, async (req, res) => {
  try {
    const { produtoid } = req.params;
    
    console.log(`🔍 Buscando dados EAN14 para produto ${produtoid}`);

    const query = `
      SELECT 
        pe.id,
        pe.id_produto,
        pe.ean14,
        pe.quantidade
      FROM produtos_ean14 pe
      WHERE pe.id_produto = $1 
        AND pe.ean14 LIKE '9%'
      LIMIT 1
    `;

    const resultado = await pool.query(query, [produtoid]);

    if (resultado.rows.length === 0) {
      return res.status(404).json({ 
        erro: 'Produto não possui configuração de pallet (EAN14 iniciando com 9)' 
      });
    }

    console.log(`✅ EAN14 encontrado: ${resultado.rows[0].ean14} - Quantidade: ${resultado.rows[0].quantidade}`);
    res.json(resultado.rows[0]);

  } catch (error) {
    console.error('❌ Erro ao buscar dados EAN14:', error);
    res.status(500).json({ erro: 'Erro ao buscar configuração do pallet' });
  }
});

// 12. FINALIZAR MONTAGEM DE PALLET
routerEntradaProducao.post("/finalizar-pallet", autenticarToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    await liberarEntradasEmRecebimentoExpiradas(client);

    const {
      id_entrada,
      produtoid,
      posicao_id,
      codigo_barras_posicao,
      quantidade,
      itens_bipados,
      ean14
    } = req.body;

    const quantidadeSolicitada = parseInt(quantidade, 10);
    if (isNaN(quantidadeSolicitada) || quantidadeSolicitada <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Quantidade do pallet inválida' });
    }

    console.log(`📦 Finalizando montagem de pallet - Produto: ${produtoid}, Quantidade total: ${quantidade}`);

    // 1. Sincronizar e materializar entradas do AWORKS para garantir que TODO kardex pendente
    // do produto esteja disponível no FIFO de baixa
    await client.query('SAVEPOINT sp_sync_aworks');
    try {
      await client.query("SELECT atualizar_entradas_aworks()");
      await client.query("SELECT * FROM sincronizar_saidas_kardex()");
      await preencherProdutoIdLogsSaidas(client);
      await client.query('RELEASE SAVEPOINT sp_sync_aworks');
    } catch (syncError) {
      await client.query('ROLLBACK TO SAVEPOINT sp_sync_aworks');
      const msg = String(syncError?.message || '');

      const precisaRepararSync = precisaRepararSincronizarSaidas(msg);

      if (precisaRepararSync) {
        console.warn('⚠️ Função sincronizar_saidas_kardex desatualizada. Aplicando reparo automático...');
        try {
          await repararFuncaoSincronizarSaidasKardex(client);
          await client.query("SELECT * FROM sincronizar_saidas_kardex()");
          await preencherProdutoIdLogsSaidas(client);
          console.log('✅ Função sincronizar_saidas_kardex reparada e sincronização executada.');
        } catch (repairError) {
          await client.query('ROLLBACK TO SAVEPOINT sp_sync_aworks');
          console.warn('⚠️ Falha ao reparar sincronizar_saidas_kardex (seguindo sem sync):', repairError.message);
        }
      } else {
        console.warn("⚠️ Erro na sincronização AWORKS durante finalizar-pallet (seguindo sem sync):", msg);
      }

      await client.query('RELEASE SAVEPOINT sp_sync_aworks');
    }

    const materializarEntradasQuery = `
      WITH entradas_existentes AS (
        SELECT
          COALESCE(SUM(ep.quantidade_total - ep.quantidade_recebida), 0)::integer AS quantidade_disponivel
        FROM entrada_producao ep
        WHERE ep.produtoid = $1
          AND ep.quantidade_recebida < ep.quantidade_total
          AND COALESCE(ep.status, 'PENDENTE') IN ('PENDENTE', 'EM_RECEBIMENTO')
          AND NOT EXISTS (
            SELECT 1
            FROM entrada_producao_saidas_log esl
            WHERE esl.kardexid_entrada_original = ep.kardexid
              AND esl.usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
          )
      ),
      deficit AS (
        SELECT GREATEST($2::integer - quantidade_disponivel, 0)::integer AS quantidade_deficit
        FROM entradas_existentes
      ),
      movimentos_aworks AS (
        SELECT
          v.kardexid,
          v.produtoid,
          v.qt_kardex,
          v.tipo_kardex,
          v.usuarioid,
          v.dt_kardex,
          ABS(v.qt_kardex) AS qt_absoluta,
          ROW_NUMBER() OVER (
            PARTITION BY v.produtoid, v.usuarioid, ABS(v.qt_kardex), v.tipo_kardex
            ORDER BY v.dt_kardex DESC, v.kardexid DESC
          ) AS rn_tipo
        FROM vw_entradas_producao_aworks v
        WHERE v.usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
          AND v.dt_kardex >= NOW() - INTERVAL '120 hours'
      ),
      entradas_aworks_disponiveis AS (
        SELECT e.*
        FROM movimentos_aworks e
        LEFT JOIN movimentos_aworks s
          ON s.tipo_kardex = 'SAIDA'
          AND e.tipo_kardex = 'ENTRADA'
          AND s.produtoid = e.produtoid
          AND s.usuarioid = e.usuarioid
          AND s.qt_absoluta = e.qt_absoluta
          AND s.rn_tipo = e.rn_tipo
          AND s.dt_kardex > e.dt_kardex
        WHERE e.tipo_kardex = 'ENTRADA'
          AND s.kardexid IS NULL
      ),
      entradas_nao_materializadas AS (
        SELECT
          vaw.kardexid,
          vaw.produtoid,
          vaw.qt_kardex::integer AS quantidade_total,
          vaw.usuarioid,
          vaw.dt_kardex
        FROM entradas_aworks_disponiveis vaw
        WHERE vaw.tipo_kardex = 'ENTRADA'
          AND vaw.produtoid = $1
          AND NOT EXISTS (
            SELECT 1
            FROM entrada_producao ep
            WHERE ep.kardexid = vaw.kardexid
              AND ep.produtoid = vaw.produtoid
          )
      ),
      entradas_necessarias AS (
        SELECT
          enm.*,
          SUM(enm.quantidade_total) OVER (ORDER BY enm.dt_kardex ASC, enm.kardexid ASC) AS soma_acumulada
        FROM entradas_nao_materializadas enm
      ),
      selecionadas AS (
        SELECT en.*
        FROM entradas_necessarias en
        CROSS JOIN deficit d
        WHERE d.quantidade_deficit > 0
          AND (en.soma_acumulada - en.quantidade_total) < d.quantidade_deficit
      )
      INSERT INTO entrada_producao (
        kardexid,
        produtoid,
        quantidade_total,
        quantidade_recebida,
        status,
        usuario_origem,
        data_kardex,
        id_operador_recebimento,
        created_at,
        updated_at
      )
      SELECT
        s.kardexid,
        s.produtoid,
        s.quantidade_total,
        0,
        'PENDENTE',
        s.usuarioid,
        s.dt_kardex,
        NULL,
        NOW(),
        NOW()
      FROM selecionadas s
      ON CONFLICT (kardexid, produtoid) WHERE status IN ('PENDENTE', 'EM_RECEBIMENTO') DO NOTHING
    `;

    await client.query(materializarEntradasQuery, [produtoid, quantidadeSolicitada]);

    // 2. Buscar TODAS as entradas pendentes materializadas do produto (FIFO)
    const entradasPendentesQuery = await client.query(
      `SELECT
         ep.id,
         ep.kardexid,
         ep.quantidade_total,
         ep.quantidade_recebida,
         ep.status,
         ep.data_kardex,
         (ep.quantidade_total - ep.quantidade_recebida) as quantidade_pendente
       FROM entrada_producao ep
       WHERE ep.produtoid = $1
         AND ep.quantidade_recebida < ep.quantidade_total
         AND COALESCE(ep.status, 'PENDENTE') IN ('PENDENTE', 'EM_RECEBIMENTO')
         AND NOT EXISTS (
           SELECT 1
           FROM entrada_producao_saidas_log esl
           WHERE esl.kardexid_entrada_original = ep.kardexid
             AND esl.usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
         )
       ORDER BY ep.data_kardex ASC, ep.id ASC`,
      [produtoid]
    );

    if (entradasPendentesQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Nenhuma entrada pendente encontrada para este produto' });
    }

    const entradasPendentes = entradasPendentesQuery.rows;
    console.log(`📋 Entradas pendentes encontradas: ${entradasPendentes.length}`);
    
    let quantidadeRestante = quantidadeSolicitada;
    const entradasProcessadas = [];
    const entradasFinalizadas = [];

    // 3. Processar entradas seguindo FIFO (mais antigas primeiro)
    for (const entrada of entradasPendentes) {
      if (quantidadeRestante <= 0) break;

      const quantidadePendente = parseInt(entrada.quantidade_pendente);
      const quantidadeAProcessar = Math.min(quantidadePendente, quantidadeRestante);
      const novaQuantidadeRecebida = parseInt(entrada.quantidade_recebida) + quantidadeAProcessar;
      const novoStatus = novaQuantidadeRecebida >= entrada.quantidade_total ? 'FINALIZADO' : 'EM_RECEBIMENTO';

      // Atualizar a entrada (em unidades)
      await client.query(
        `UPDATE entrada_producao
         SET quantidade_recebida = $1,
             status = $2::varchar,
             id_operador_recebimento = $4,
             data_inicio_recebimento = COALESCE(data_inicio_recebimento, NOW()),
             data_finalizacao = CASE WHEN $2::varchar = 'FINALIZADO'::varchar THEN NOW() ELSE data_finalizacao END,
             foi_liberado_por_timeout = false,
             updated_at = NOW()
         WHERE id = $3`,
        [novaQuantidadeRecebida, novoStatus, entrada.id, req.user.id]
      );

      // Criar registro em entrada_producao_itens para cada entrada consumida
      const observacao = `Pallet montado - EAN14: ${ean14} - Processado ${quantidadeAProcessar} de ${quantidadePendente} unidades desta entrada - ${(itens_bipados || []).length} itens bipados`;
      
      await client.query(
        `INSERT INTO entrada_producao_itens (
          id_entrada_producao,
          id_posicao,
          quantidade_colocada,
          id_operador_posicao,
          observacoes
        ) VALUES ($1, $2, $3, $4, $5)`,
        [entrada.id, posicao_id, quantidadeAProcessar, req.user.id, observacao]
      );

      console.log(`✅ Entrada ${entrada.id} processada: ${quantidadeAProcessar} unidades - Status: ${novoStatus}`);

      entradasProcessadas.push({
        id: entrada.id,
        kardexid: entrada.kardexid,
        quantidade_processada: quantidadeAProcessar,
        novo_status: novoStatus,
        quantidade_total: entrada.quantidade_total,
        quantidade_recebida: novaQuantidadeRecebida
      });

      if (novoStatus === 'FINALIZADO') {
        entradasFinalizadas.push(entrada.id);
      }

      quantidadeRestante -= quantidadeAProcessar;
    }

    if (quantidadeRestante > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        erro: `Quantidade insuficiente. Faltam ${quantidadeRestante} unidades nas entradas pendentes.` 
      });
    }

    // 4. Validar se a posição existe
    const posicaoCheck = await client.query(
      `SELECT id, codigo_barras, capacidade 
       FROM posicoes 
       WHERE id = $1 AND id_local_estoque = 1`,
      [posicao_id]
    );

    if (posicaoCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Posição não encontrada ou não pertence à EXPEDIÇÃO' });
    }

    // 5. Atualizar contagem_estoque - mantém o controle real do estoque nas posições
    const ultimoInventarioQuery = `
      SELECT id FROM inventario 
      ORDER BY id DESC 
      LIMIT 1
    `;
    
    const inventarioResult = await client.query(ultimoInventarioQuery);
    const id_inventario = inventarioResult.rows[0]?.id || 1;

    const upsertContagemQuery = `
      INSERT INTO contagem_estoque (
        id_produto, 
        id_posicao, 
        quantidade_pacotes, 
        id_operador, 
        id_inventario, 
        id_local_estoque,
        local_estoque
      ) VALUES ($1, $2, $3, $4, $5, 1, 'expedicao')
      RETURNING *
    `;

    await definirContextoAuditoriaEstoque(client, {
      id_operador: req.user.id,
      origem_modulo: "ENTRADA_PRODUCAO",
      origem_tipo: "FINALIZAR_PALLET",
      referencia_movimento: "FINALIZAR_PALLET",
      id_referencia: id_entrada || entradasProcessadas[0]?.id || null,
      observacao: `Pallet ${ean14 || ''} em posição ${codigo_barras_posicao || posicao_id}`,
    });

    await client.query(upsertContagemQuery, [
      produtoid, 
      posicao_id, 
      quantidade, 
      req.user.id,
      id_inventario
    ]);

    console.log(`✅ Contagem de estoque registrada: ${quantidade} pacote(s) na posição ${posicao_id}`);

    await client.query('COMMIT');

    res.json({
      sucesso: true,
      mensagem: 'Pallet montado e armazenado com sucesso',
      quantidade: quantidade,
      entradas_processadas: entradasProcessadas,
      entradas_finalizadas: entradasFinalizadas,
      posicao_codigo: codigo_barras_posicao,
      // Campos para compatibilidade com código anterior
      entrada_id: entradasProcessadas[0]?.id,
      status_entrada: entradasProcessadas[0]?.novo_status,
      total_recebido: entradasProcessadas[0]?.quantidade_recebida,
      total_entrada: entradasProcessadas[0]?.quantidade_total
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao finalizar montagem de pallet:', error);
    res.status(500).json({ 
      erro: 'Erro ao finalizar montagem do pallet',
      detalhes: error.message 
    });
  } finally {
    client.release();
  }
});

  // ==================== ENDPOINTS PARA PROCESSAR SAÍDAS DO KARDEX ====================

  // 1. LISTAR SAÍDAS NÃO PROCESSADAS
  routerEntradaProducao.get("/saidas-nao-processadas", autenticarToken, async (req, res) => {
    try {
      console.log("🔍 Buscando saídas não processadas do AWORKS");

      const query = `
        SELECT 
          COALESCE(esl.id, 0) as log_id,
          esl.kardexid_saida,
          esl.kardexid_entrada_original,
          esl.produtoid,
          esl.quantidade_saida,
          esl.usuarioid,
          esl.dt_saida,
          esl.operador_saida,
          esl.status as status_processamento,
          ep.id as entrada_id,
          ep.quantidade_total,
          ep.quantidade_recebida,
          ep.quantidade_removida,
          ep.status_remocao,
          p.referencia_produto,
          p.ds_produto,
          op.nome as operador_nome
        FROM entrada_producao_saidas_log esl
        LEFT JOIN entrada_producao ep ON esl.kardexid_entrada_original = ep.kardexid
        LEFT JOIN produtos p ON esl.produtoid = p.id_cache
        LEFT JOIN operadores op ON esl.usuarioid = op.id
        WHERE esl.status IN ('PENDENTE', 'ERRO')
        AND esl.dt_saida >= NOW() - INTERVAL '120 hours'
        ORDER BY esl.dt_saida DESC
      `;

      const resultado = await pool.query(query);
      res.json(resultado.rows);
    } catch (error) {
      console.error("❌ Erro ao buscar saídas não processadas:", error);
      res.status(500).json({ erro: "Erro ao buscar saídas", detalhes: error.message });
    }
  });

  // 2. PROCESSAR UMA SAÍDA MANUALMENTE
  routerEntradaProducao.post("/processar-saida/:kardexidSaida", autenticarToken, async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { kardexidSaida } = req.params;
      const { kardexidEntrada, quantidade, usuarioId } = req.body;

      await client.query('SELECT pg_advisory_xact_lock($1)', [Number(kardexidSaida)]);

      if (!OPERADORES_SAIDA_PERMITIDOS.includes(Number(usuarioId))) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          erro: "Saída não permitida para este operador",
          detalhes: "Somente operadores autorizados podem processar saída de estoque"
        });
      }

      const logJaProcessado = await client.query(
        `SELECT id, kardexid_entrada_original
         FROM entrada_producao_saidas_log
         WHERE kardexid_saida = $1
           AND status = 'PROCESSADO'
         ORDER BY id DESC
         LIMIT 1`,
        [Number(kardexidSaida)]
      );

      if (logJaProcessado.rowCount > 0) {
        await client.query("COMMIT");
        return res.json({
          sucesso: true,
          mensagem: "Saída já processada anteriormente (idempotente)",
          entrada_id: logJaProcessado.rows[0].kardexid_entrada_original,
          quantidade_restante: null,
        });
      }

      console.log(`📤 Processando saída kardex ${kardexidSaida}`);

      await client.query("SELECT atualizar_entradas_aworks()");

      const validacaoProduto = await validarProdutoSaidaContraEntrada(
        client,
        Number(kardexidEntrada),
        parseInt(kardexidSaida)
      );

      if (!validacaoProduto.valido) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          erro: "Entrada e saída pertencem a produtos diferentes",
          detalhes: validacaoProduto.motivo,
          entradaProdutoId: validacaoProduto.entradaProdutoId || null,
          saidaProdutoId: validacaoProduto.saidaProdutoId || null,
        });
      }

      // Chamar função de processamento
      const resultado = await client.query(
        `SELECT * FROM processar_saida_kardex($1, $2, $3, $4, NOW())`,
        [kardexidEntrada, parseInt(kardexidSaida), parseInt(quantidade), usuarioId]
      );

      await preencherProdutoIdLogsSaidas(client);

      await client.query("COMMIT");

      const resposta = resultado.rows[0];
      res.json({
        sucesso: resposta.sucesso,
        mensagem: resposta.mensagem,
        entrada_id: resposta.entrada_id,
        quantidade_restante: resposta.quantidade_restante
      });

    } catch (error) {
      await client.query("ROLLBACK");
      console.error("❌ Erro ao processar saída:", error);
      res.status(500).json({ erro: "Erro ao processar saída", detalhes: error.message });
    } finally {
      client.release();
    }
  });

  // 3. SINCRONIZAR SAÍDAS AUTOMATICAMENTE DO KARDEX
  routerEntradaProducao.post("/sincronizar-saidas", autenticarToken, async (req, res) => {
    try {
      console.log("🔄 Sincronizando saídas do kardex...");

      // Primeiro, atualizar a view materializada para pegar dados mais recentes
      await pool.query("SELECT atualizar_entradas_aworks()");

      // Executar sincronização com tentativa de auto-reparo
      let resultado;
      try {
        resultado = await pool.query(`SELECT * FROM sincronizar_saidas_kardex()`);
        await preencherProdutoIdLogsSaidas(pool);
      } catch (syncError) {
        const msg = String(syncError?.message || '');
        if (precisaRepararSincronizarSaidas(msg)) {
          console.warn('⚠️ Função sincronizar_saidas_kardex desatualizada. Aplicando reparo automático...');
          await repararSincronizarSaidasGlobal();
          resultado = await pool.query(`SELECT * FROM sincronizar_saidas_kardex()`);
          await preencherProdutoIdLogsSaidas(pool);
          console.log('✅ Função sincronizar_saidas_kardex reparada e sincronização executada.');
        } else {
          throw syncError;
        }
      }

      const resposta = resultado.rows[0];

      res.json({
        sucesso: true,
        processadas: resposta.processadas,
        erros: resposta.erros,
        mensagem: resposta.mensagem
      });

    } catch (error) {
      console.error("❌ Erro ao sincronizar saídas:", error);
      res.status(500).json({ erro: "Erro ao sincronizar saídas", detalhes: error.message });
    }
  });

  // 4. LISTAR HISTÓRICO DE SAÍDAS PROCESSADAS
  routerEntradaProducao.get("/saidas-processadas", autenticarToken, async (req, res) => {
    try {
      const query = `
        SELECT 
          esl.id,
          esl.kardexid_saida,
          esl.kardexid_entrada_original,
          esl.produtoid,
          esl.quantidade_saida,
          esl.usuarioid,
          esl.dt_saida,
          esl.dt_processamento,
          esl.operador_saida,
          esl.status,
          esl.observacoes,
          ep.id as entrada_id,
          ep.quantidade_total,
          ep.quantidade_removida,
          ep.status_remocao,
          p.referencia_produto,
          p.ds_produto,
          op.nome as operador_nome
        FROM entrada_producao_saidas_log esl
        LEFT JOIN entrada_producao ep ON esl.kardexid_entrada_original = ep.kardexid
        LEFT JOIN produtos p ON esl.produtoid = p.id_cache
        LEFT JOIN operadores op ON esl.usuarioid = op.id
        WHERE esl.status = 'PROCESSADO'
        AND esl.dt_saida >= NOW() - INTERVAL '7 days'
        ORDER BY esl.dt_processamento DESC
        LIMIT 500
      `;

      const resultado = await pool.query(query);
      res.json(resultado.rows);
    } catch (error) {
      console.error("❌ Erro ao buscar saídas processadas:", error);
      res.status(500).json({ erro: "Erro ao buscar saídas", detalhes: error.message });
    }
  });

// 🆕 DASHBOARD DE ENTRADA - KPIs e Métricas Gerenciais
routerEntradaProducao.get("/dashboard/resumo", autenticarToken, async (req, res) => {
  try {
    const { periodo = 'hoje' } = req.query;
    const periodoNormalizado = ['hoje', 'semana', '30dias'].includes(periodo) ? periodo : 'hoje';
    const normalizarDataHora = (valor) => {
      if (!valor || typeof valor !== 'string') return null;
      const valorNormalizado = valor.trim().replace('T', ' ');
      if (/^\d{4}-\d{2}-\d{2}$/.test(valorNormalizado)) {
        return { valorSql: valorNormalizado, temHora: false };
      }
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(valorNormalizado)) {
        return { valorSql: `${valorNormalizado}:00`, temHora: true };
      }
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(valorNormalizado)) {
        return { valorSql: valorNormalizado, temHora: true };
      }
      return null;
    };
    const dataInicioParsed = normalizarDataHora(req.query.dataInicio);
    const dataFimParsed = normalizarDataHora(req.query.dataFim);
    const dataInicio = dataInicioParsed?.valorSql || null;
    const dataFim = dataFimParsed?.valorSql || null;

    const dataInicioFiltro = dataInicio && !dataInicioParsed.temHora
      ? `${dataInicio} 00:00:00`
      : dataInicio;
    const dataFimFiltro = dataFim && !dataFimParsed.temHora
      ? `${dataFim} 23:59:59`
      : dataFim;

    const filtroPeriodo =
      dataInicioFiltro && dataFimFiltro
        ? `ep.created_at BETWEEN '${dataInicioFiltro}'::timestamp AND '${dataFimFiltro}'::timestamp`
        : dataInicioFiltro
          ? `ep.created_at >= '${dataInicioFiltro}'::timestamp`
          : dataFimFiltro
            ? `ep.created_at <= '${dataFimFiltro}'::timestamp`
            : periodoNormalizado === 'semana'
              ? "ep.created_at >= CURRENT_DATE - INTERVAL '6 days' AND ep.created_at < CURRENT_DATE + INTERVAL '1 day'"
              : periodoNormalizado === '30dias'
                ? "ep.created_at >= CURRENT_DATE - INTERVAL '29 days' AND ep.created_at < CURRENT_DATE + INTERVAL '1 day'"
                : "DATE(ep.created_at) = CURRENT_DATE";

    console.log(`📊 Buscando KPIs de entrada do estoque - período: ${periodoNormalizado} | início: ${dataInicio || '-'} | fim: ${dataFim || '-'}`);

    // KPIs do período (sem duplicação por join de itens)
    const kpisQuery = `
      WITH entradas_filtradas AS (
        SELECT
          ep.id,
          ep.status,
          COALESCE(ep.quantidade_total, 0) as quantidade_total,
          COALESCE(ep.quantidade_recebida, 0) as quantidade_recebida,
          ep.id_operador_recebimento,
          ep.created_at,
          ep.data_finalizacao
        FROM entrada_producao ep
        WHERE ${filtroPeriodo}
          AND ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
      )
      SELECT
        COALESCE(COUNT(*), 0) as total_entradas_finalizadas,
        COALESCE(SUM(CASE WHEN ef.status = 'FINALIZADO' THEN ef.quantidade_total ELSE 0 END), 0) as quantidade_recebida_periodo,
        COALESCE(SUM(CASE WHEN ef.status = 'FINALIZADO' THEN ef.quantidade_total ELSE 0 END), 0) as volume_recebido_hoje,
        COALESCE(COUNT(CASE WHEN ef.status = 'FINALIZADO' THEN 1 END), 0) as entradas_finalizadas,
        COALESCE(COUNT(CASE WHEN ef.status IN ('PENDENTE', 'EM_RECEBIMENTO') THEN 1 END), 0) as entradas_pendentes,
        (
          SELECT COALESCE(COUNT(DISTINCT epi.id_posicao), 0)
          FROM entrada_producao_itens epi
          JOIN entradas_filtradas ef_pos ON ef_pos.id = epi.id_entrada_producao
        ) as posicoes_utilizadas,
        COALESCE(COUNT(DISTINCT ef.id_operador_recebimento), 0) as operadores_ativos,
        ROUND(
          100.0 * COALESCE(COUNT(CASE WHEN ef.status = 'FINALIZADO' THEN 1 END), 0) /
          NULLIF(COUNT(*), 0),
          2
        ) as taxa_finalizacao,
        ROUND(
          COALESCE(AVG(CASE WHEN ef.status = 'FINALIZADO' THEN EXTRACT(EPOCH FROM (ef.data_finalizacao - ef.created_at)) / 60 END), 0),
          2
        ) as tempo_medio_minutos,
        COALESCE(SUM(CASE WHEN ef.status IN ('PENDENTE', 'EM_RECEBIMENTO') THEN GREATEST(ef.quantidade_total - ef.quantidade_recebida, 0) ELSE 0 END), 0) as unidades_pendentes,
        ROUND(
          100.0 * COALESCE(SUM(ef.quantidade_recebida), 0) /
          NULLIF(SUM(ef.quantidade_total), 0),
          2
        ) as percentual_atendimento
      FROM entradas_filtradas ef
    `;

    const kpisResult = await pool.query(kpisQuery);
    const kpis = kpisResult.rows[0] || {};

    // Ranking de operadores (top 10)
    const operadoresQuery = `
      SELECT 
        ep.id_operador_recebimento as id_operador,
        op.nome as operador_nome,
        COUNT(DISTINCT ep.id) as entradas_finalizadas,
        COALESCE(SUM(ep.quantidade_total), 0) as quantidade_total,
        COALESCE(SUM(ep.quantidade_total), 0) as volume_total,
        ROUND(
          COALESCE(AVG(EXTRACT(EPOCH FROM (ep.data_finalizacao - ep.created_at)) / 60), 0),
          2
        ) as tempo_medio_minutos,
        COUNT(DISTINCT epi.id_posicao) as posicoes_utilizadas
      FROM entrada_producao ep
      LEFT JOIN entrada_producao_itens epi ON ep.id = epi.id_entrada_producao
      LEFT JOIN operadores op ON ep.id_operador_recebimento = op.id
      WHERE ${filtroPeriodo}
        AND ep.status = 'FINALIZADO'
        AND ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
      GROUP BY ep.id_operador_recebimento, op.nome
      ORDER BY volume_total DESC, entradas_finalizadas DESC
      LIMIT 10
    `;

    const operadoresResult = await pool.query(operadoresQuery);

    // Top posições utilizadas
    const posicoesQuery = `
      SELECT 
        epi.id_posicao,
        p.codigo as codigo_posicao,
        COALESCE(
          MAX(NULLIF(CONCAT_WS('-', r.codigo, m.codigo, n.codigo, p.codigo), '')),
          MAX(p.codigo),
          'SEM_ENDERECAMENTO'
        ) as enderecamento_completo,
        COUNT(DISTINCT ep.id) as utilizacoes,
        COALESCE(SUM(epi.quantidade_colocada), 0) as quantidade_total,
        COALESCE(SUM(epi.quantidade_colocada), 0) as volume_total,
        COUNT(DISTINCT ep.id_operador_recebimento) as operadores_diferentes
      FROM entrada_producao_itens epi
      JOIN entrada_producao ep ON epi.id_entrada_producao = ep.id
      LEFT JOIN posicoes p ON epi.id_posicao = p.id
      LEFT JOIN niveis n ON p.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      WHERE ${filtroPeriodo}
        AND ep.status = 'FINALIZADO'
        AND ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
      GROUP BY epi.id_posicao, p.codigo
      ORDER BY utilizacoes DESC
      LIMIT 10
    `;

    const posicoesResult = await pool.query(posicoesQuery);

    // Status geral
    const statusQuery = `
      SELECT 
        status,
        COUNT(*) as total
      FROM entrada_producao ep
      WHERE ${filtroPeriodo}
        AND ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
      GROUP BY status
    `;

    const statusResult = await pool.query(statusQuery);

    res.json({
      kpis,
      operadores: operadoresResult.rows,
      posicoes: posicoesResult.rows,
      status: statusResult.rows,
      periodo: periodoNormalizado,
      dataInicio,
      dataFim,
      data_hora: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erro ao buscar resumo dashboard:", error);
    res.status(500).json({ erro: "Erro ao buscar resumo do dashboard" });
  }
});

// Tabela detalhada paginada
routerEntradaProducao.get("/dashboard/tabela", autenticarToken, async (req, res) => {
  try {
    const { 
      page = 0, 
      limit = 20, 
      status = '', 
      operador = '', 
      produto = '', 
      referencia = '',
      periodo = 'hoje'
    } = req.query;

    const periodoNormalizado = ['hoje', 'semana', '30dias'].includes(periodo) ? periodo : 'hoje';
    const normalizarDataHora = (valor) => {
      if (!valor || typeof valor !== 'string') return null;
      const valorNormalizado = valor.trim().replace('T', ' ');
      if (/^\d{4}-\d{2}-\d{2}$/.test(valorNormalizado)) {
        return { valorSql: valorNormalizado, temHora: false };
      }
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(valorNormalizado)) {
        return { valorSql: `${valorNormalizado}:00`, temHora: true };
      }
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(valorNormalizado)) {
        return { valorSql: valorNormalizado, temHora: true };
      }
      return null;
    };
    const dataInicioParsed = normalizarDataHora(req.query.dataInicio);
    const dataFimParsed = normalizarDataHora(req.query.dataFim);
    const dataInicio = dataInicioParsed?.valorSql || null;
    const dataFim = dataFimParsed?.valorSql || null;

    const dataInicioFiltro = dataInicio && !dataInicioParsed.temHora
      ? `${dataInicio} 00:00:00`
      : dataInicio;
    const dataFimFiltro = dataFim && !dataFimParsed.temHora
      ? `${dataFim} 23:59:59`
      : dataFim;

    const filtroPeriodo =
      dataInicioFiltro && dataFimFiltro
        ? `ep.created_at BETWEEN '${dataInicioFiltro}'::timestamp AND '${dataFimFiltro}'::timestamp`
        : dataInicioFiltro
          ? `ep.created_at >= '${dataInicioFiltro}'::timestamp`
          : dataFimFiltro
            ? `ep.created_at <= '${dataFimFiltro}'::timestamp`
            : periodoNormalizado === 'semana'
              ? "ep.created_at >= CURRENT_DATE - INTERVAL '6 days' AND ep.created_at < CURRENT_DATE + INTERVAL '1 day'"
              : periodoNormalizado === '30dias'
                ? "ep.created_at >= CURRENT_DATE - INTERVAL '29 days' AND ep.created_at < CURRENT_DATE + INTERVAL '1 day'"
                : "DATE(ep.created_at) = CURRENT_DATE";

    const offset = parseInt(page) * parseInt(limit);
    const whereConditions = [
      filtroPeriodo,
      "ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)"
    ];

    if (status) whereConditions.push(`ep.status = '${status}'`);
    if (operador) whereConditions.push(`ep.id_operador_recebimento = ${operador}`);
    if (produto) whereConditions.push(`p.ds_produto ILIKE '%${produto}%'`);
    if (referencia) whereConditions.push(`p.referencia_produto ILIKE '%${referencia}%'`);

    const whereClause = whereConditions.join(' AND ');

    const countQuery = `
      SELECT COUNT(*) as total
      FROM entrada_producao ep
      LEFT JOIN produtos p ON ep.produtoid = p.id_cache
      WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].total);

    const dataQuery = `
      SELECT 
        ep.id,
        ep.kardexid,
        ep.status,
        p.referencia_produto,
        p.ds_produto as descricao_produto,
        ep.quantidade_total,
        ep.quantidade_recebida,
        (ep.quantidade_total - ep.quantidade_recebida) as quantidade_pendente,
        op.nome as operador_nome,
        COUNT(DISTINCT epi.id) as total_posicoes,
        COALESCE(SUM(epi.quantidade_colocada), 0) as total_colocado,
        ROUND(
          EXTRACT(EPOCH FROM (ep.data_finalizacao - ep.created_at)) / 60,
          2
        ) as tempo_minutos,
        -- 🆕 ENDEREÇAMENTO - Estrutura correta: Rua-Módulo-Nível-Posição
        STRING_AGG(
          DISTINCT CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', pos.codigo),
          '|'
        ) as enderecamento,
        STRING_AGG(DISTINCT r.codigo, ',') as ruas_utilizadas,
        STRING_AGG(DISTINCT m.codigo, ',') as modulos_utilizados,
        STRING_AGG(DISTINCT n.codigo, ',') as niveis_utilizados,
        ep.created_at,
        ep.data_finalizacao
      FROM entrada_producao ep
      LEFT JOIN produtos p ON ep.produtoid = p.id_cache
      LEFT JOIN entrada_producao_itens epi ON ep.id = epi.id_entrada_producao
      LEFT JOIN posicoes pos ON epi.id_posicao = pos.id
      LEFT JOIN niveis n ON pos.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN operadores op ON ep.id_operador_recebimento = op.id
      WHERE ${whereClause}
      GROUP BY ep.id, p.referencia_produto, p.ds_produto, op.nome
      ORDER BY ep.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const dataResult = await pool.query(dataQuery);

    res.json({
      data: dataResult.rows,
      pagina: parseInt(page),
      limite: parseInt(limit),
      total,
      periodo: periodoNormalizado,
      dataInicio,
      dataFim,
      paginas_totais: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error("❌ Erro ao buscar tabela dashboard:", error);
    res.status(500).json({ erro: "Erro ao buscar tabela do dashboard" });
  }
});

routerEntradaProducao.get("/dashboard/export", autenticarToken, async (req, res) => {
  try {
    const {
      status = '',
      operador = '',
      produto = '',
      referencia = '',
      periodo = 'hoje',
      formato = 'excel'
    } = req.query;

    const periodoNormalizado = ['hoje', 'semana', '30dias'].includes(periodo) ? periodo : 'hoje';
    const formatoNormalizado = String(formato).toLowerCase() === 'pdf' ? 'pdf' : 'excel';

    const normalizarDataHora = (valor) => {
      if (!valor || typeof valor !== 'string') return null;
      const valorNormalizado = valor.trim().replace('T', ' ');
      if (/^\d{4}-\d{2}-\d{2}$/.test(valorNormalizado)) {
        return { valorSql: valorNormalizado, temHora: false };
      }
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(valorNormalizado)) {
        return { valorSql: `${valorNormalizado}:00`, temHora: true };
      }
      if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(valorNormalizado)) {
        return { valorSql: valorNormalizado, temHora: true };
      }
      return null;
    };

    const dataInicioParsed = normalizarDataHora(req.query.dataInicio);
    const dataFimParsed = normalizarDataHora(req.query.dataFim);
    const dataInicio = dataInicioParsed?.valorSql || null;
    const dataFim = dataFimParsed?.valorSql || null;

    const dataInicioFiltro = dataInicio && !dataInicioParsed.temHora
      ? `${dataInicio} 00:00:00`
      : dataInicio;
    const dataFimFiltro = dataFim && !dataFimParsed.temHora
      ? `${dataFim} 23:59:59`
      : dataFim;

    const filtroPeriodo =
      dataInicioFiltro && dataFimFiltro
        ? `ep.created_at BETWEEN '${dataInicioFiltro}'::timestamp AND '${dataFimFiltro}'::timestamp`
        : dataInicioFiltro
          ? `ep.created_at >= '${dataInicioFiltro}'::timestamp`
          : dataFimFiltro
            ? `ep.created_at <= '${dataFimFiltro}'::timestamp`
            : periodoNormalizado === 'semana'
              ? "ep.created_at >= CURRENT_DATE - INTERVAL '6 days' AND ep.created_at < CURRENT_DATE + INTERVAL '1 day'"
              : periodoNormalizado === '30dias'
                ? "ep.created_at >= CURRENT_DATE - INTERVAL '29 days' AND ep.created_at < CURRENT_DATE + INTERVAL '1 day'"
                : "DATE(ep.created_at) = CURRENT_DATE";

    const whereConditions = [
      filtroPeriodo,
      "ep.usuario_origem IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)"
    ];

    if (status) whereConditions.push(`ep.status = '${status}'`);
    if (operador) whereConditions.push(`ep.id_operador_recebimento = ${operador}`);
    if (produto) whereConditions.push(`p.ds_produto ILIKE '%${produto}%'`);
    if (referencia) whereConditions.push(`p.referencia_produto ILIKE '%${referencia}%'`);

    const whereClause = whereConditions.join(' AND ');

    const dataQuery = `
      SELECT
        ep.kardexid,
        ep.status,
        p.referencia_produto,
        p.ds_produto as descricao_produto,
        ep.quantidade_total,
        ep.quantidade_recebida,
        (ep.quantidade_total - ep.quantidade_recebida) as quantidade_pendente,
        op.nome as operador_nome,
        ep.created_at,
        ep.data_finalizacao,
        STRING_AGG(
          DISTINCT CONCAT(r.codigo, '-', m.codigo, '-', n.codigo, '-', pos.codigo),
          '|'
        ) as enderecamento
      FROM entrada_producao ep
      LEFT JOIN produtos p ON ep.produtoid = p.id_cache
      LEFT JOIN entrada_producao_itens epi ON ep.id = epi.id_entrada_producao
      LEFT JOIN posicoes pos ON epi.id_posicao = pos.id
      LEFT JOIN niveis n ON pos.id_nivel = n.id
      LEFT JOIN modulos m ON n.id_modulo = m.id
      LEFT JOIN ruas r ON m.id_rua = r.id
      LEFT JOIN operadores op ON ep.id_operador_recebimento = op.id
      WHERE ${whereClause}
      GROUP BY ep.id, p.referencia_produto, p.ds_produto, op.nome
      ORDER BY ep.created_at DESC
    `;

    const dataResult = await pool.query(dataQuery);
    const linhas = dataResult.rows || [];

    if (formatoNormalizado === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Entrada Producao');

      worksheet.columns = [
        { header: 'Kardex', key: 'kardexid', width: 12 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Referencia', key: 'referencia_produto', width: 20 },
        { header: 'Descricao Produto', key: 'descricao_produto', width: 40 },
        { header: 'Qtd Total', key: 'quantidade_total', width: 12 },
        { header: 'Qtd Recebida', key: 'quantidade_recebida', width: 14 },
        { header: 'Qtd Pendente', key: 'quantidade_pendente', width: 14 },
        { header: 'Operador', key: 'operador_nome', width: 24 },
        { header: 'Data Criacao', key: 'created_at', width: 22 },
        { header: 'Data Finalizacao', key: 'data_finalizacao', width: 22 },
        { header: 'Enderecamento', key: 'enderecamento', width: 50 }
      ];

      linhas.forEach((row) => {
        worksheet.addRow({
          ...row,
          created_at: row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '',
          data_finalizacao: row.data_finalizacao ? new Date(row.data_finalizacao).toLocaleString('pt-BR') : '',
          enderecamento: row.enderecamento || ''
        });
      });

      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      const nomeArquivo = `entrada-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    const nomeArquivo = `entrada-dashboard-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(14).text('Dashboard de Entrada de Producao - Relatorio', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    doc.text(`Total de registros: ${linhas.length}`);
    doc.moveDown(1);

    linhas.forEach((row, idx) => {
      if (doc.y > 760) doc.addPage();
      doc.fontSize(9).text(
        `${idx + 1}. Kardex: ${row.kardexid || '-'} | Status: ${row.status || '-'} | Ref: ${row.referencia_produto || '-'} | Qtd: ${row.quantidade_total || 0} | Operador: ${row.operador_nome || '-'} | Data: ${row.data_finalizacao ? new Date(row.data_finalizacao).toLocaleString('pt-BR') : '-'}`
      );
    });

    doc.end();
  } catch (error) {
    console.error("❌ Erro ao exportar dashboard de entrada:", error);
    res.status(500).json({ erro: "Erro ao exportar dashboard de entrada", detalhes: error.message });
  }
});

// Registrar router de entrada de produção
app.use("/api/entrada-producao", routerEntradaProducao);
app.use("/entrada-producao", routerEntradaProducao);
console.log('✅ Router de Entrada de Produção registrado em /api/entrada-producao');
console.log('📋 Rotas de Entrada disponíveis:');
console.log('  - GET    /api/entrada-producao/aworks');
console.log('  - GET    /api/entrada-producao/pendentes');
console.log('  - POST   /api/entrada-producao');
console.log('  - GET    /api/entrada-producao/:id');
console.log('  - POST   /api/entrada-producao/:id/itens');
console.log('  - DELETE /api/entrada-producao/:id/itens/:idItem');
console.log('  - POST   /api/entrada-producao/:id/finalizar');
console.log('  - POST   /api/entrada-producao/validar-posicao');
console.log('  - POST   /api/entrada-producao/validar-produto');
console.log('  - GET    /api/entrada-producao/enderecos/:idProduto');
console.log('  - GET    /api/entrada-producao/ean14/:produtoid  🆕 PALLET');
console.log('  - POST   /api/entrada-producao/finalizar-pallet  🆕 PALLET');
console.log('  - GET    /api/entrada-producao/dashboard/resumo  🆕 DASHBOARD');
console.log('  - GET    /api/entrada-producao/dashboard/tabela  🆕 DASHBOARD');
console.log('  - GET    /api/entrada-producao/dashboard/export  🆕 EXPORT');
console.log('');

// =============================================
// SINCRONIZAÇÃO AUTOMÁTICA DE DATAS
// =============================================

// Executar sincronização ao iniciar (pega os despachos já preenchidos)
async function sincronizarDatasAoIniciar() {
  try {
    console.log('\n🔄 Sincronizando datas de despacho com separação ao iniciar...');
    
    const pedidosQuery = `
      SELECT DISTINCT
        pdp.pedidovendaid,
        pdp.data_despacho_prevista
      FROM pedidos_despacho_previsto pdp
      WHERE pdp.data_despacho_prevista IS NOT NULL
      ORDER BY pdp.data_despacho_prevista DESC
      LIMIT 100
    `;

    const result = await pool.query(pedidosQuery);
    const pedidos = result.rows;
    console.log(`📋 Encontrados ${pedidos.length} pedidos com data de despacho`);

    let atualizados = 0;

    for (const pedido of pedidos) {
      try {
        const dataInicioSeparacao = await calcularDataInicioSeparacao(pedido.data_despacho_prevista);
        const dataInicioFormatada = dataInicioSeparacao.toISOString().split('T')[0];

        const updateResult = await pool.query(
          `
          UPDATE separacao_pedidos 
          SET 
            data_inicio_separacao = $1,
            data_prioridade_separacao = $1,
            updated_at = NOW()
          WHERE pedidovendaid = $2
          AND (data_inicio_separacao IS NULL OR data_inicio_separacao != $1)
          RETURNING pedidovendaid
        `,
          [dataInicioFormatada, pedido.pedidovendaid],
        );

        if (updateResult.rows.length > 0) {
          atualizados++;
        }
      } catch (erro) {
        console.error(`⚠️ Erro ao processar pedido ${pedido.pedidovendaid}:`, erro.message);
      }
    }

    console.log(`✅ Sincronização concluída: ${atualizados} pedidos atualizados\n`);
  } catch (error) {
    console.error('❌ Erro ao sincronizar datas ao iniciar:', error.message);
  }
}

// 🔄 Job automático: Liberar EM_RECEBIMENTO expiradas
function agendarLiberacaoAutomaticaEmRecebimento() {
  // Executa imediatamente no boot para recuperar entradas travadas antigas
  liberarEntradasEmRecebimentoExpiradas(pool).catch((error) => {
    console.error('❌ Erro na liberação automática inicial:', error.message);
  });

  // Verificar a cada 2 minutos
  setInterval(async () => {
    try {
      await liberarEntradasEmRecebimentoExpiradas(pool);
    } catch (error) {
      console.error('❌ Erro no job de liberação automática:', error.message);
    }
  }, 2 * 60 * 1000); // A cada 2 minutos
  console.log('✅ Job de liberação automática iniciado (a cada 2 minutos)');
}

// 🔄 Job automático: Finalizar entradas completas e refletir no estoque
function agendarAutoFinalizacaoEntradasCompletas() {
  autoFinalizarEntradasCompletas()
    .catch((error) => {
      console.error('❌ Erro na auto-finalização inicial:', error.message);
    });

  setInterval(async () => {
    try {
      await autoFinalizarEntradasCompletas();
    } catch (error) {
      console.error('❌ Erro no job de auto-finalização:', error.message);
    }
  }, INTERVALO_AUTO_FINALIZACAO_MINUTOS * 60 * 1000);

  console.log(`✅ Job de auto-finalização iniciado (a cada ${INTERVALO_AUTO_FINALIZACAO_MINUTOS} minutos)`);
}

// Agendar sincronização periódica (a cada hora)
function agendarSincronizacaoPeriodica() {
  // Sincronizar a cada 60 minutos
  setInterval(async () => {
    try {
      const pedidosQuery = `
        SELECT DISTINCT
          pdp.pedidovendaid,
          pdp.data_despacho_prevista,
          pdp.data_atualizacao
        FROM pedidos_despacho_previsto pdp
        WHERE pdp.data_despacho_prevista IS NOT NULL
        AND pdp.data_atualizacao > NOW() - INTERVAL '1 hour'
        ORDER BY pdp.data_atualizacao DESC
      `;

      const result = await pool.query(pedidosQuery);
      if (result.rows.length > 0) {
        console.log(`🔄 Sincronizando ${result.rows.length} despachos atualizados...`);
        
        for (const pedido of result.rows) {
          try {
            const dataInicioSeparacao = await calcularDataInicioSeparacao(pedido.data_despacho_prevista);
            const dataInicioFormatada = dataInicioSeparacao.toISOString().split('T')[0];

            await pool.query(
              `
              UPDATE separacao_pedidos 
              SET 
                data_inicio_separacao = $1,
                data_prioridade_separacao = $1,
                updated_at = NOW()
              WHERE pedidovendaid = $2
              AND (data_inicio_separacao IS NULL OR data_inicio_separacao != $1)
            `,
              [dataInicioFormatada, pedido.pedidovendaid],
            );
          } catch (erro) {
            // Silenciosamente registrar, sem quebrar o intervalo
            console.error(`⚠️ Erro no job periódico para pedido ${pedido.pedidovendaid}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Erro no job de sincronização periódica:', error.message);
    }
  }, 60 * 60 * 1000); // 60 minutos
}

// =============================================
// ROTAS DE RESERVAS DE ESTOQUE
// =============================================

// Buscar reservas de estoque de um pedido
app.get("/separacao/pedidos/:pedidoId/reservas", autenticarToken, async (req, res) => {
  const { pedidoId } = req.params;

  try {
    // Usar EXATAMENTE a mesma lógica da rota de itens
    const query = `
      SELECT 
        re.id,
        re.pedidovendaitemid,
        re.pedidovendaid,
        re.id_posicao,
        re.quantidade_reservada,
        re.data_reserva,
        re.status,
        re.prioridade_pedido,
        re.observacoes,
        
        -- Informações do produto - MESMA LÓGICA DA ROTA DE ITENS
        pi.ds_produto as produto_descricao,
        pi.referencia as produto_referencia,
        pi.produtoid as produtoid_original,
        
        -- Informações da posição - MESMA ESTRUTURA DA ROTA DE ENDEREÇOS
        p.codigo as codigo_endereco,
        CONCAT(
          'Rua ', r.codigo, 
          CASE WHEN r.descricao IS NOT NULL THEN CONCAT(' (', r.descricao, ')') ELSE '' END,
          ', Módulo ', m.codigo,
          CASE WHEN m.descricao IS NOT NULL THEN CONCAT(' (', m.descricao, ')') ELSE '' END,
          ', Nível ', n.codigo,
          CASE WHEN n.descricao IS NOT NULL THEN CONCAT(' (', n.descricao, ')') ELSE '' END,
          ', Posição ', p.codigo,
          CASE WHEN p.descricao IS NOT NULL THEN CONCAT(' (', p.descricao, ')') ELSE '' END
        ) as descricao_completa
        
      FROM public.reservas_estoque re
      
      -- Join com separacao_itens para pegar o pedidovendaitemid REAL do AWORKS
      LEFT JOIN public.separacao_itens si ON si.id = re.pedidovendaitemid
      
      -- Join com a view do AWORKS usando o pedidovendaitemid CORRETO
      LEFT JOIN public.vw_pedido_itens_aworks_simples pi ON pi.pedidovendaitemid = si.pedidovendaitemid
      
      -- Join com posições (MESMA HIERARQUIA DA ROTA DE ENDEREÇOS)
      LEFT JOIN public.posicoes p ON p.id = re.id_posicao
      LEFT JOIN public.niveis n ON n.id = p.id_nivel
      LEFT JOIN public.modulos m ON m.id = n.id_modulo
      LEFT JOIN public.ruas r ON r.id = m.id_rua
      
      WHERE re.pedidovendaid = $1
      ORDER BY 
        CASE re.status 
          WHEN 'ATIVA' THEN 1 
          WHEN 'UTILIZADA' THEN 2 
          WHEN 'CANCELADA' THEN 3 
        END,
        re.data_reserva DESC
    `;

    const result = await pool.query(query, [pedidoId]);

    res.json(result.rows);
  } catch (error) {
    console.error("Erro ao buscar reservas de estoque:", error);
    res.status(500).json({ 
      erro: "Erro ao buscar reservas de estoque",
      detalhes: error.message 
    });
  }
});

// Liberar uma reserva específica (apenas para administradores)
app.post("/separacao/reservas/:reservaId/liberar", autenticarToken, async (req, res) => {
  const { reservaId } = req.params;
  const { id_operador } = req.body;

  // Verificar permissão - apenas operadores autorizados
  const operadoresAutorizados = [1, 2, 3, 4, 6, 43];
  
  if (!operadoresAutorizados.includes(id_operador)) {
    return res.status(403).json({ 
      erro: "Você não tem permissão para liberar reservas de estoque" 
    });
  }

  try {
    // Atualizar status da reserva para CANCELADA
    const updateQuery = `
      UPDATE public.reservas_estoque 
      SET 
        status = 'CANCELADA',
        observacoes = CONCAT(
          COALESCE(observacoes, ''), 
          E'\n[', 
          NOW()::timestamp(0)::text, 
          '] Liberada pelo operador ID: ', 
          $2::text
        ),
        updated_at = NOW()
      WHERE id = $1 
      AND status = 'ATIVA'
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [reservaId, id_operador]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        erro: "Reserva não encontrada ou já foi liberada" 
      });
    }

    // Registrar log
    await registrarLog(
      'LIBERAR_RESERVA',
      `Reserva ${reservaId} liberada`,
      { reservaId, id_operador },
      null,
      id_operador
    );

    res.json({
      sucesso: true,
      mensagem: "Reserva liberada com sucesso",
      reserva: result.rows[0]
    });
  } catch (error) {
    console.error("Erro ao liberar reserva:", error);
    await registrarErro("Erro ao liberar reserva", error, null, id_operador);
    res.status(500).json({ 
      erro: "Erro ao liberar reserva",
      detalhes: error.message 
    });
  }
});

// Liberar todas as reservas ativas de um pedido (apenas para administradores)
app.post("/separacao/pedidos/:pedidoId/reservas/liberar-todas", autenticarToken, async (req, res) => {
  const { pedidoId } = req.params;
  const { id_operador } = req.body;

  // Verificar permissão
  const operadoresAutorizados = [1, 2, 3, 4, 6, 43];
  
  if (!operadoresAutorizados.includes(id_operador)) {
    return res.status(403).json({ 
      erro: "Você não tem permissão para liberar reservas de estoque" 
    });
  }

  try {
    // Atualizar todas as reservas ativas do pedido
    const updateQuery = `
      UPDATE public.reservas_estoque 
      SET 
        status = 'CANCELADA',
        observacoes = CONCAT(
          COALESCE(observacoes, ''), 
          E'\n[', 
          NOW()::timestamp(0)::text, 
          '] Liberação em massa pelo operador ID: ', 
          $2::text
        ),
        updated_at = NOW()
      WHERE pedidovendaid = $1 
      AND status = 'ATIVA'
      RETURNING id
    `;

    const result = await pool.query(updateQuery, [pedidoId, id_operador]);

    // Registrar log
    await registrarLog(
      'LIBERAR_TODAS_RESERVAS',
      `${result.rows.length} reservas liberadas para pedido ${pedidoId}`,
      { pedidoId, id_operador, quantidade: result.rows.length },
      null,
      id_operador
    );

    res.json({
      sucesso: true,
      mensagem: `${result.rows.length} reserva(s) liberada(s) com sucesso`,
      liberadas: result.rows.length
    });
  } catch (error) {
    console.error("Erro ao liberar todas as reservas:", error);
    await registrarErro("Erro ao liberar todas as reservas", error, null, id_operador);
    res.status(500).json({ 
      erro: "Erro ao liberar todas as reservas",
      detalhes: error.message 
    });
  }
});

// ✅ Inicializar tabelas necessárias
async function garantirColunasEntradaProducao() {
  try {
    // Verificar se coluna foi_liberado_por_timeout existe
    const checkColuna = `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'entrada_producao' 
        AND column_name = 'foi_liberado_por_timeout'
      );
    `;
    const result = await pool.query(checkColuna);
    
    if (!result.rows[0].exists) {
      console.log('📝 Adicionando coluna foi_liberado_por_timeout...');
      await pool.query(`
        ALTER TABLE entrada_producao 
        ADD COLUMN foi_liberado_por_timeout BOOLEAN DEFAULT FALSE;
      `);
      console.log('✅ Coluna foi_liberado_por_timeout criada com sucesso');
    }
  } catch (error) {
    console.error('⚠️ Erro ao verificar/criar coluna:', error.message);
  }
}

async function garantirColunasPerfilOperadores() {
  try {
    const colunasNecessarias = [
      { nome: 'cargo', definicao: 'VARCHAR(150)' },
      { nome: 'telefone', definicao: 'VARCHAR(30)' },
      { nome: 'foto_url', definicao: 'TEXT' },
    ];

    for (const coluna of colunasNecessarias) {
      const checkColuna = await pool.query(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'operadores'
          AND column_name = $1
        );`,
        [coluna.nome],
      );

      if (!checkColuna.rows[0].exists) {
        console.log(`📝 Adicionando coluna ${coluna.nome} em operadores...`);
        await pool.query(`ALTER TABLE operadores ADD COLUMN ${coluna.nome} ${coluna.definicao};`);
      }
    }
  } catch (error) {
    console.error('⚠️ Erro ao verificar/criar colunas de perfil dos operadores:', error.message);
  }
}

// Iniciar o servidor
server.listen(port, async () => {
  console.log(`Servidor rodando na porta ${port}`);
  

  
  // Aguardar um pouco para garantir que o pool esteja pronto
  setTimeout(async () => {
    console.log('\n🚀 Executando sincronizações iniciais...');
    await garantirColunasEntradaProducao(); // Verificar/criar coluna de timeout
    await garantirColunasPerfilOperadores();
    await sincronizarDatasAoIniciar();
    agendarLiberacaoAutomaticaEmRecebimento(); // 🔄 Job automático de timeout
    agendarAutoFinalizacaoEntradasCompletas(); // 🔄 Job automático para não acumular completos
    agendarSincronizacaoPeriodica();
  }, 2000);
});
