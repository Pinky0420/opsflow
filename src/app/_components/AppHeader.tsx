"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { stripAppBasePath } from "@/lib/appPath";

type Props = {
  subtitle?: string;
  role?: string | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: (pathname: string) => boolean;
};

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 4v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V7l7-4Z" />
    </svg>
  );
}

function TrainingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5V6.5A2.5 2.5 0 0 1 6.5 4H20" />
      <path d="M8 6h12v14H8a2 2 0 0 1 0-4h12" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function navItemClass(active: boolean) {
  return active
    ? "bg-zinc-900 text-white shadow-sm"
    : "text-zinc-700 hover:bg-zinc-100";
}

function NavigationContent({ pathname, onNavigate, role, onSignOut }: { pathname: string; onNavigate: () => void; role?: string | null; onSignOut: () => void }) {
  const items: NavItem[] = [
    {
      href: "/",
      label: "主頁",
      icon: <HomeIcon />,
      active: (value) => value === "/",
    },
    {
      href: "/training",
      label: "教育訓練資料",
      icon: <TrainingIcon />,
      active: (value) => value === "/training" || value.startsWith("/training/"),
    },
  ];

  if (role === "admin") {
    items.push({
      href: "/admin/access",
      label: "權限管理",
      icon: <ShieldIcon />,
      active: (value) => value === "/admin/access" || value.startsWith("/admin/access/"),
    });
  }

  return (
    <>
      <nav className="flex flex-col gap-1.5 text-sm">
        {items.map((item) => {
          const active = item.active(pathname);
          return (
            <Link
              key={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${navItemClass(active)}`}
              href={item.href}
              onClick={onNavigate}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          <span className="shrink-0"><LogoutIcon /></span>
          <span>登出</span>
        </button>
      </div>
    </>
  );
}

export default function AppHeader({ subtitle, role }: Props) {
  const [open, setOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pathname = stripAppBasePath(usePathname());
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("opsflow.desktopSidebarOpen");
    if (stored === "0") setDesktopSidebarOpen(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function syncSidebarOffset() {
      const isDesktop = window.innerWidth >= 768;
      document.documentElement.style.setProperty("--app-sidebar-offset", isDesktop && desktopSidebarOpen ? "19rem" : "0px");
    }

    window.localStorage.setItem("opsflow.desktopSidebarOpen", desktopSidebarOpen ? "1" : "0");
    syncSidebarOffset();
    window.addEventListener("resize", syncSidebarOffset);
    return () => {
      window.removeEventListener("resize", syncSidebarOffset);
    };
  }, [desktopSidebarOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    function onMouseDown(e: MouseEvent) {
      if (!open) return;
      const el = panelRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setDesktopSidebarOpen((value) => !value)}
        className="fixed left-3 top-3 z-50 hidden h-10 w-10 items-center justify-center rounded-lg border bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50 md:inline-flex"
        aria-label={desktopSidebarOpen ? "收起側邊欄" : "展開側邊欄"}
        aria-expanded={desktopSidebarOpen}
      >
        <MenuIcon />
      </button>

      <aside className={`fixed inset-y-0 left-0 z-40 hidden w-72 border-r bg-white transition-transform duration-300 md:flex md:flex-col ${desktopSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="border-b px-5 py-4">
          <Link href="/" className="text-lg font-semibold hover:opacity-80" onClick={() => setOpen(false)}>
            OpsFlow
          </Link>
          {subtitle ? <div className="mt-1 text-sm text-zinc-500">{subtitle}</div> : null}
          {role ? <div className="mt-2 text-sm text-zinc-500">role: {role}</div> : null}
        </div>

        <div className="flex-1 px-4 py-4">
          <NavigationContent pathname={pathname} onNavigate={() => setOpen(false)} role={role} onSignOut={handleSignOut} />
        </div>
      </aside>

      <header className="border-b bg-white md:hidden">
      <div className="flex h-14 w-full items-center justify-between px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-zinc-100"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <MenuIcon />
          </button>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href="/" className="text-base font-semibold hover:opacity-80 sm:text-lg">
              OpsFlow
            </Link>
            {subtitle ? <span className="truncate text-sm text-zinc-500 sm:text-base">{subtitle}</span> : null}
          </div>
        </div>

        <div className="max-w-[42vw] shrink-0 truncate pl-3 text-right text-sm text-zinc-500 sm:text-base">{role ? `role: ${role}` : null}</div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/30 transition-opacity" />
          <div ref={panelRef} className="relative h-full w-72 max-w-[85vw] border-r bg-white px-3 py-4 shadow-xl transition-transform duration-300 ease-out sm:px-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-semibold">選單</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-zinc-100"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>

            <NavigationContent pathname={pathname} onNavigate={() => setOpen(false)} role={role} onSignOut={handleSignOut} />
          </div>
        </div>
      ) : null}
    </header>
    </>
  );
}
