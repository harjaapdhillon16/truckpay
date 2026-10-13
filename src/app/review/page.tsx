import { DashboardWorkspace } from "@/components/dashboard-workspace";

export const metadata = { title: "Review queue · LoadWallet" };

export default function ReviewQueuePage() {
  return <DashboardWorkspace view="review" filter="attention" />;
}
