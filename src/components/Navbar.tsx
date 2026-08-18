"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Languages, LayoutDashboard, Mic, History, BarChart3 } from "lucide-react";
import { cn } from "../../lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "New Translation", href: "/new", icon: Mic },
  { name: "History", href: "/history", icon: History },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Derive page title from route
  const getPageTitle = () => {
    if (pathname === "/") return "Dashboard";
    if (pathname === "/new") return "New Translation";
    if (pathname.startsWith("/history")) return "History";
    if (pathname === "/analytics") return "Analytics";
    return "Mozhi";
  };

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between h-16 px-4 border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:bg-zinc-950/80 dark:border-zinc-800 md:px-8">
      {/* Mobile menu button & logo */}
      <div className="flex items-center gap-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 -ml-2 text-zinc-600 rounded-lg hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          aria-label="Open mobile menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-black">
            <Languages className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
            Mozhi
          </span>
        </Link>
      </div>

      {/* Page Title (Desktop only) */}
      <h1 className="hidden md:block text-lg font-semibold text-zinc-900 dark:text-white font-sans">
        {getPageTitle()}
      </h1>

      {/* Header End Actions */}
      <div className="flex items-center gap-4">
        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900">
          Supabase Connected
        </span>
      </div>

      {/* Mobile navigation menu drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-zinc-950/50 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer container */}
          <div className="relative flex flex-col w-full max-w-xs p-6 bg-white dark:bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <Link href="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-black">
                  <Languages className="w-5 h-5" />
                </div>
                <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
                  Mozhi
                </span>
              </Link>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 -mr-2 text-zinc-600 rounded-lg hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                aria-label="Close menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 space-y-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center px-4 py-3.5 text-base font-medium rounded-xl transition-all duration-200 gap-3",
                      isActive
                        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-white"
                        : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-white"
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
