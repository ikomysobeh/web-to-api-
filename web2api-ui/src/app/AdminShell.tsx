import { Outlet } from "react-router-dom";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";

export default function AdminShell() {
  return (
    <div className="app-bg flex h-screen w-screen overflow-hidden text-foreground">
      <div className="hidden md:flex">
        <AdminSidebar />
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
