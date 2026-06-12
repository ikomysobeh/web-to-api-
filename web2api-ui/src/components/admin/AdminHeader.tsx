import { useLocation } from "react-router-dom";

const SECTION_TITLES: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/agents": "Agents",
  "/admin/users": "Users",
};

export function AdminHeader() {
  const { pathname } = useLocation();
  const title =
    SECTION_TITLES[pathname] ??
    (pathname.startsWith("/admin/agents/") ? "Agent Details" : "Admin");

  return (
    <header className="glass-nav z-30 flex h-13 shrink-0 items-center border-b border-white/5 px-6">
      <h1 className="text-sm font-semibold tracking-tight text-zinc-100">{title}</h1>
    </header>
  );
}
