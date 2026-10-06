"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  History,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { cn } from "../../lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "New Translation", href: "/new", icon: Upload },
  { name: "History", href: "/history", icon: History },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-zinc-150 dark:bg-zinc-950 dark:border-zinc-900 font-sans">
      <div className="flex flex-col flex-1 min-h-0">
        {/* Logo/Brand */}
        <div className="flex items-center h-20 px-6 border-b border-zinc-100 dark:border-zinc-900">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="Mozhi Logo"
              width={36}
              height={36}
              priority
              className="w-9 h-9 object-contain rounded-lg"
            />
            <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Mozhi
            </span>
          </Link>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 px-4 py-8 space-y-1.5 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center px-4 py-3.5 text-sm font-semibold rounded-xl transition-all duration-200 group gap-3",
                  isActive
                    ? "bg-teal-50/60 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900/50 dark:hover:text-white"
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5 transition-colors duration-200",
                    isActive
                      ? "text-teal-600 dark:text-teal-400"
                      : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                  )}
                />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Plan card & user details (inspired by the bottom left of the reference image) */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-900 space-y-4">
          {/* Plan badge */}
          <div className="p-3.5 bg-zinc-50 border border-zinc-100 rounded-xl dark:bg-zinc-900/40 dark:border-zinc-800/80 flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Plan</p>
              <p className="text-xs font-bold text-teal-600 dark:text-teal-400">Free Tier</p>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </div>

          {/* User profile info */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-teal-600 text-white font-bold text-sm shadow-sm">
              M
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-zinc-800 dark:text-white truncate">Mozhi User</p>
              <p className="text-[10px] text-zinc-400 truncate mt-0.5">user@mozhi.ai</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
