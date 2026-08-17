/**
 * Helpers de resposta HTTP padronizados.
 * Garante consistência no formato das respostas da API.
 */
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
}

const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const created = (res, data) => res.status(201).json({ success: true, ...data });
const fail = (res, message, status = 400) => res.status(status).json({ success: false, error: message });

module.exports = { HttpError, ok, created, fail };
