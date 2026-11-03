import {
  BadgePercent, BarChart3, Building2, Calculator, CalendarCheck, FileText, HandCoins, Landmark, LayoutDashboard, Mail,
  MinusCircle, Settings, SlidersHorizontal, TrendingUp, UserCog, UserRound, Users, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BadgePercent, BarChart3, Building2, Calculator, CalendarCheck, FileText, HandCoins, Landmark, LayoutDashboard, Mail,
  MinusCircle, Settings, SlidersHorizontal, TrendingUp, UserCog, UserRound, Users,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const I = ICONS[name] ?? LayoutDashboard;
  return <I className={className} />;
}
