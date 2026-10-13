export const LOAD_VIEWS = [
  { href: "/loads", label: "All loads", filter: "all" },
  { href: "/loads/active", label: "Active", filter: "active" },
  { href: "/loads/completed", label: "Completed", filter: "paid" },
  { href: "/review", label: "Needs attention", filter: "attention" },
] as const;

export type LoadFilter = (typeof LOAD_VIEWS)[number]["filter"];
export type DashboardView = "overview" | "loads" | "payments" | "review";

export function dashboardSection(pathname: string) {
  if (pathname === "/") return "/";
  if (pathname.startsWith("/loads")) return "/loads";
  if (pathname.startsWith("/payments")) return "/payments";
  if (pathname.startsWith("/review")) return "/review";
  return null;
}

export function dashboardLabel(pathname: string) {
  if (pathname === "/guide") return "How it works";
  if (pathname === "/loads/new") return "Book a load";
  if (pathname === "/loads/active") return "Active loads";
  if (pathname === "/loads/completed") return "Completed loads";
  if (pathname === "/loads") return "All loads";
  if (pathname.startsWith("/loads/")) return "Load details";
  if (pathname === "/payments") return "Payments";
  if (pathname === "/review") return "Review queue";
  return "Overview";
}
