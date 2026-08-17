/**
 * Rotas de health check.
 * Prefixo: /health
 */
const express = require("express");
const router = express.Router();
const { prisma } = require("../../config/prisma");
const { asyncHandler } = require("../../middlewares/error");

router.get("/", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

router.get(
  "/database",
  asyncHandler(async (req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "OK", database: "connected" });
  })
);

module.exports = router;
