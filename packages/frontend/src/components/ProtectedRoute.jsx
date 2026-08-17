import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/**
 * Rota protegida: redireciona para /login se não autenticado.
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: "2rem" }}>Carregando...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
