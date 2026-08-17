/**
 * Ponto de entrada do servidor.
 * Inicia o Express e (futuramente) o Socket.IO para tempo real.
 */
const http = require("http");
const { env } = require("./config/env");
const { createApp } = require("./app");

const app = createApp();
const server = http.createServer(app);

// TODO (próxima entrega): inicializar Socket.IO aqui para dashboards em tempo real.
//   const { Server } = require("socket.io");
//   const io = new Server(server, { cors: { origin: env.cors.origins } });
//   io.on("connection", (socket) => { ... });

server.listen(env.port, () => {
  console.log(`✅ Servidor rodando na porta ${env.port} [${env.nodeEnv}]`);
  console.log(`   Health: http://localhost:${env.port}/health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM recebido. Encerrando servidor...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT recebido. Encerrando servidor...");
  server.close(() => process.exit(0));
});
