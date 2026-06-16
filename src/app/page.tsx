"use client";

import { useEffect, useState } from "react";
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

const TAB_IDS = Object.keys(META) as TabId[];
function isTabId(v: string | null): v is TabId {
  return v !== null && (TAB_IDS as string[]).includes(v);
}

export default function Page() {
  const [tab, setTab] = useState<TabId>("dial");

  // Read the active tab from the URL on mount (?tab=bulk) so refresh/bookmark sticks.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (isTabId(fromUrl)) setTab(fromUrl);
  }, []);

  // Keep the URL query in sync when the tab changes (without a navigation/scroll).
  function changeTab(t: TabId) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  // After creating a campaign, jump to Bulk with it pre-selected (FEATURE 5).
  // BulkTab reads its campaign from this persisted key on mount, so writing it
  // before switching tabs makes the new campaign the active selection.
  function onCampaignCreated(id: string) {
    try {
      window.localStorage.setItem("ivr.bulk.campaignId", JSON.stringify(id));
    } catch {
      /* storage blocked — non-fatal, user can pick it manually */
    }
    changeTab("bulk");
  }

  return (
    <>
      <Shell
        tab={tab}
        setTab={changeTab}
        title={META[tab].title}
        description={META[tab].desc}
        onLogout={logout}
      >
        {tab === "dial" && <DialTab />}
        {tab === "bulk" && <BulkTab />}
        {tab === "campaigns" && <CampaignsTab onCreated={onCampaignCreated} />}
        {tab === "audios" && <AudiosTab />}
        {tab === "reports" && <ReportsTab />}
        {tab === "whatsapp" && <WhatsAppTab />}
      </Shell>
      <Toaster />
    </>
  );
}
