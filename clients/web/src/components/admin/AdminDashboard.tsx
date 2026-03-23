import { useState } from "react";
import { AdminOverview } from "./AdminOverview";
import { AdminUsers } from "./AdminUsers";
import { AdminServers } from "./AdminServers";
import { AdminSettings } from "./AdminSettings";
import styles from "./AdminDashboard.module.css";

type AdminTab = "overview" | "users" | "servers" | "settings";

interface AdminDashboardProps {
  onBack: () => void;
}

export function AdminDashboard({ onBack }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Instance Admin</h1>
        </div>
        <button className={styles.backBtn} onClick={onBack}>
          Back to App
        </button>
      </header>

      <nav className={styles.tabs}>
        {(["overview", "users", "servers", "settings"] as AdminTab[]).map(
          (tab) => (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ),
        )}
      </nav>

      <div className={styles.content}>
        {activeTab === "overview" && <AdminOverview />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "servers" && <AdminServers />}
        {activeTab === "settings" && <AdminSettings />}
      </div>
    </div>
  );
}
