"use client";

import { useState } from "react";
import DialTab from "@/components/DialTab";
import BulkTab from "@/components/BulkTab";
import CampaignsTab from "@/components/CampaignsTab";
import AudiosTab from "@/components/AudiosTab";
import ReportsTab from "@/components/ReportsTab";
import WhatsAppTab from "@/components/WhatsAppTab";
import { Toaster } from "@/components/ui";
import { Shell, TabId } from "@/components/Shell";

const META: Record<TabId, { title: string; desc: string }> = {
  dial:      { title: "Single call",     desc: "Place an outbound IVR call from a campaign" },
  bulk:      { title: "Bulk calls",      desc: "Run a paced batch through a campaign" },
  campaigns: { title: "Campaigns",       desc: "Audio, prompt, webhook, and from-number per campaign" },
  audios:    { title: "Audio library",   desc: "Upload or link MP3s used by campaigns" },
  reports:   { title: "Reports",         desc: "Volumes, lift rate, outcomes, CSV export" },
  whatsapp:  { title: "WhatsApp",        desc: "Direct Pabbly fire — single or bulk" },
};

export default function Page() {
  const [tab, setTab] = useState<TabId>("dial");

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <>
      <Shell
        tab={tab}
        setTab={setTab}
        title={META[tab].title}
        description={META[tab].desc}
        onLogout={logout}
      >
        {tab === "dial" && <DialTab />}
        {tab === "bulk" && <BulkTab />}
        {tab === "campaigns" && <CampaignsTab />}
        {tab === "audios" && <AudiosTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "whatsapp" && <WhatsAppTab />}
      </Shell>
      <Toaster />
    </>
  );
}
