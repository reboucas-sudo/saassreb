import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const navStyle = ({ isActive }) => ({
  padding: "0.5rem 1rem",
  textDecoration: "none",
  color: isActive ? "#fff" : "#cbd5e1",
  background: isActive ? "#2563eb" : "transparent",
  borderRadius: "6px",
});

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          background: "#1e293b",
          color: "#fff",
          padding: "0.75rem 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "1.5rem",
        }}
      >
        <strong>🏭 Plásticos Injetados</strong>
        <nav style={{ display: "flex", gap: "0.5rem" }}>
          <NavLink to="/produtos" style={navStyle}>
            Produtos
          </NavLink>
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ color: "#94a3b8" }}>{user?.nome}</span>
          <button
            onClick={handleLogout}
            style={{
              background: "#dc2626",
              color: "#fff",
              border: "none",
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <main style={{ flex: 1, padding: "1.5rem", background: "#f1f5f9" }}>
        <Outlet />
      </main>
    </div>
  );
}
