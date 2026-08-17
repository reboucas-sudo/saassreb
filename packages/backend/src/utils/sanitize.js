/**
 * Sanitização de objetos de operador.
 * Remove campos sensíveis (senha) antes de enviar para o cliente.
 * Equivalente ao `sanitizeOperador` do server.js antigo (linha 703).
 */
function sanitizeOperador(operador) {
  if (!operador) return null;
  const { senha, ...operadorSeguro } = operador;
  return operadorSeguro;
}

module.exports = { sanitizeOperador };
