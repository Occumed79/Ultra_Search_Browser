"use client";

import Link from "next/link";
import { Bookmark, Clock as ClockIcon, Settings } from "lucide-react";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/history", label: "History", icon: ClockIcon },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="relative z-20 flex items-center justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
      <Link href="/" className="logo-glow flex min-w-0 items-center" aria-label="Ultra Search home">
        <img
          src="/brand/logo.png"
          alt="Ultra Search"
          className="h-12 w-auto max-w-[180px] object-contain sm:h-14 sm:max-w-[220px]"
        />
      </Link>

      <nav className="flex items-center gap-2" aria-label="Primary navigation">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`glass-button ${active ? "border-teal-200/25 bg-teal-200/[0.09] text-white" : ""}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
