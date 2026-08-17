/**
 * Instância singleton do PrismaClient.
 * Reutilizada em toda a aplicação para evitar múltiplas conexões.
 */
const { PrismaClient } = require("@prisma/client");

const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query", "error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

module.exports = { prisma };
