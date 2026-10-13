import { DashboardWorkspace } from "@/components/dashboard-workspace";

export const metadata = { title: "Active loads · LoadWallet" };

export default function ActiveLoadsPage() {
  return <DashboardWorkspace view="loads" filter="active" />;
}
