import { DashboardWorkspace } from "@/components/dashboard-workspace";

export const metadata = { title: "Completed loads · LoadWallet" };

export default function CompletedLoadsPage() {
  return <DashboardWorkspace view="loads" filter="paid" />;
}
