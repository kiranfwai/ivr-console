"use client";

import { useState } from "react";
import DialTab from "@/components/DialTab";
import BulkTab from "@/components/BulkTab";
import CampaignsTab from "@/components/CampaignsTab";
import AudiosTab from "@/components/AudiosTab";
import ReportsTab from "@/components/ReportsTab";
import WhatsAppTab from "@/components/WhatsAppTab";
import { Toaster } from "@/components/ui";

type TabId = "dial" | "bulk" | "campaigns" | "audios" | "reports" | "whatsapp";

const TABS: { id: TabId; label: string }[] = [
  { id: "dial", label: "Dial" },
  { id: "bulk", label: "Bulk" },
  { id: "campaigns", label: "Campaigns" },
  { id: "audios", label: "Audios" },
  { id: "reports", label: "Reports" },
  { id: "whatsapp", label: "WhatsApp" },
];

export default function Page() {
  const [tab, setTab] = useState<TabId>("dial");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">📞</div>
            <div>
              <div className="font-semibold">IVR Console</div>
              <div className="text-xs text-muted">Outbound + WhatsApp control panel</div>
            </div>
          </div>
          <button onClick={logout} className="text-sm text-muted hover:text-ink">Sign out</button>
        </div>
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 -mb-px transition ${
                tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "dial" && <DialTab />}
        {tab === "bulk" && <BulkTab />}
        {tab === "campaigns" && <CampaignsTab />}
        {tab === "audios" && <AudiosTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "whatsapp" && <WhatsAppTab />}
      </main>
      <Toaster />
    </div>
  );
}
