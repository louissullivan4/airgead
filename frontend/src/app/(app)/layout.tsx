"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Header,
  HeaderName,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SideNav,
  SideNavItems,
  SideNavLink,
  Theme,
} from "@carbon/react";
import { Dashboard, Receipt, Settings, Help, Logout } from "@carbon/icons-react";
import { BRAND } from "@/lib/brand";
import { api } from "@/lib/api";
import SupportModal from "@/components/SupportModal";
import "@carbon/charts/styles.css";

interface NavDest {
  label: string;
  href: string;
  icon: typeof Dashboard;
}

const DESTINATIONS: NavDest[] = [
  { label: "Home", href: "/home", icon: Dashboard },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Settings", href: "/settings", icon: Settings },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [supportOpen, setSupportOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  async function handleLogout() {
    await api.auth.logout().catch(() => {});
    router.push("/login");
  }

  return (
    <Theme theme="white" className="app-shell">
      <Header aria-label={`${BRAND} navigation`}>
        <HeaderName href="/home" prefix="">
          {BRAND}
        </HeaderName>
        <HeaderGlobalBar>
          <HeaderGlobalAction
            aria-label="Support"
            onClick={() => setSupportOpen(true)}
          >
            <Help size={20} />
          </HeaderGlobalAction>
          <HeaderGlobalAction aria-label="Log out" onClick={handleLogout}>
            <Logout size={20} />
          </HeaderGlobalAction>
        </HeaderGlobalBar>
      </Header>

      <SideNav
        aria-label="Side navigation"
        isPersistent
        expanded
        isChildOfHeader={false}
      >
        <SideNavItems>
          {DESTINATIONS.map(({ label, href, icon }) => (
            <SideNavLink
              key={href}
              as={Link}
              href={href}
              renderIcon={icon}
              isActive={isActive(href)}
            >
              {label}
            </SideNavLink>
          ))}
          <SideNavLink
            renderIcon={Help}
            onClick={() => setSupportOpen(true)}
            href="#support"
          >
            Support
          </SideNavLink>
        </SideNavItems>
      </SideNav>

      <main className="app-content">{children}</main>

      {/* Mobile bottom navigation */}
      <nav className="bottom-nav" aria-label="Primary">
        {DESTINATIONS.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`bottom-nav__item${
              isActive(href) ? " bottom-nav__item--active" : ""
            }`}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
        <button
          type="button"
          className="bottom-nav__item"
          onClick={() => setSupportOpen(true)}
        >
          <Help size={20} />
          Support
        </button>
      </nav>

      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
    </Theme>
  );
}
