import { Outlet } from "react-router-dom";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminHeader } from "@/components/admin/AdminHeader";

export default function AdminShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-foreground">
      <div className="hidden md:flex">
        <AdminSidebar />
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <AdminHeader />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
