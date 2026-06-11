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
    <header className="flex h-13 shrink-0 items-center border-b border-zinc-800/70 bg-zinc-950/80 px-6 backdrop-blur-sm">
      <h1 className="text-sm font-semibold text-zinc-100">{title}</h1>
    </header>
  );
}
