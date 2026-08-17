import api from "./client";

export async function login(identificador, senha) {
  const { data } = await api.post("/auth/login", { identificador, senha });
  return data;
}

export async function renovarToken() {
  const { data } = await api.post("/auth/renovar-token");
  return data;
}
