import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "../components/app-sidebar"
import { AdminAuthGuard } from "../components/auth-guard"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <main className="w-full flex flex-col min-h-screen bg-muted/20">
          <header className="flex h-14 items-center gap-4 border-b bg-background px-6 lg:h-[60px]">
              <SidebarTrigger />
              <h1 className="text-lg font-semibold">后台管理系统</h1>
          </header>
          <div className="flex-1 p-6">
              {children}
          </div>
        </main>
      </SidebarProvider>
    </AdminAuthGuard>
  )
}
