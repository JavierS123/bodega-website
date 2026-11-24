import {
  BarChart3,
  Bot,
  GraduationCap,
  Package,
  ReceiptText,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Dictionary } from "@/lib/i18n/config";

type NavKey = "cashier" | "inventory" | "transactions" | "clients" | "owners" | "analytics" | "skill";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: (t: Dictionary) => string;
  hint: (t: Dictionary) => string;
}

const item = (href: string, icon: LucideIcon, key: NavKey): NavItem => ({
  href,
  icon,
  label: (t) => t.nav[key],
  hint: (t) => t.nav[`${key}Hint`],
});

export const NAV_ITEMS: NavItem[] = [
  item("/", Bot, "cashier"),
  item("/inventory", Package, "inventory"),
  item("/transactions", ReceiptText, "transactions"),
  item("/clients", Users, "clients"),
  item("/owners", Wallet, "owners"),
  item("/analytics", BarChart3, "analytics"),
  item("/skill", GraduationCap, "skill"),
];

/** "/" only matches exactly; other items also match their sub-routes. */
export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
