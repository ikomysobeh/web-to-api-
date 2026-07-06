import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";

const ADMIN_SIDEBAR_COLLAPSED_KEY = "lumina_admin_sidebar_collapsed";

export default function AdminShell() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_KEY) === "1",
  );

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="app-bg flex h-screen w-screen overflow-hidden text-foreground">
      {/* Desktop: user-toggleable expand/collapse */}
      <div className="hidden md:flex">
        <AdminSidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </div>

      {/* Mobile: persistent, always-collapsed icon rail — a w-64 nav would
          break a phone-width layout, so there's nothing to expand into here. */}
      <div className="flex md:hidden">
        <AdminSidebar collapsed onToggleCollapse={() => {}} hideToggle />
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <AdminHeader />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
