"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu, X, LayoutDashboard, Upload, History, BarChart3 } from "lucide-react";
import { cn } from "../../lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "New Translation", href: "/new", icon: Upload },
  { name: "History", href: "/history", icon: History },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Derive page title from route
  const getPageTitle = () => {
    if (pathname === "/") return "Audio Transcription Dashboard";
    if (pathname === "/new") return "Audio Transcription Dashboard";
    if (pathname.startsWith("/history")) return "Translation History";
    if (pathname === "/analytics") return "System Analytics";
    return "Mozhi";
  };

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between h-20 px-6 border-b border-zinc-150 bg-white/90 backdrop-blur-md dark:bg-zinc-950/90 dark:border-zinc-900 md:px-8 font-sans">
      {/* Mobile menu button & logo */}
      <div className="flex items-center gap-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 -ml-2 text-zinc-600 rounded-xl hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
          aria-label="Open mobile menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Mozhi Logo"
            width={32}
            height={32}
            priority
            className="w-8 h-8 object-contain rounded-lg"
          />
          <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
            Mozhi
          </span>
        </Link>
      </div>

      {/* Page Title & Subtitle (Desktop only) */}
      <div className="hidden md:block space-y-0.5">
        <h1 className="text-xl font-extrabold text-zinc-900 dark:text-white leading-tight">
          {getPageTitle()}
        </h1>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">
          {pathname === "/new" || pathname === "/"
            ? "AI-powered Tamil & Telugu speech transcription, translation, and insights"
            : "Manage your transcript history and analytics"}
        </p>
      </div>

      {/* Header End Actions */}
      <div className="flex items-center gap-4">
        <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/60">
          Supabase Connected
        </span>
      </div>

      {/* Mobile navigation menu drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer container */}
          <div className="relative flex flex-col w-full max-w-xs p-6 bg-white dark:bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between mb-8">
              <Link href="/" className="flex items-center gap-2.5" onClick={() => setMobileMenuOpen(false)}>
                <Image
                  src="/logo.png"
                  alt="Mozhi Logo"
                  width={32}
                  height={32}
                  priority
                  className="w-8 h-8 object-contain rounded-lg"
                />
                <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
                  Mozhi
                </span>
              </Link>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 -mr-2 text-zinc-600 rounded-lg hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
                aria-label="Close menu"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 space-y-1.5">
              {navigation.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center px-4 py-3.5 text-base font-semibold rounded-xl transition-all duration-200 gap-3",
                      isActive
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400"
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
