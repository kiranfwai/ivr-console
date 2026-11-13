"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Select } from "./ui";

/**
 * The campaign picker used on Dial, Bulk, Reports and Dashboard.
 *
 * Accounts collect campaigns fast (one live client had 107, oldest first in a
 * plain dropdown). This lists them newest first and, once there are more than a
 * handful, adds a filter box above the dropdown. The selected campaign is always
 * kept in the list, so filtering never silently changes what is chosen.
 */
export default function CampaignSelect({
  campaigns,
  value,
  onChange,
  emptyLabel,
}: {
  campaigns: { id: string; name: string; createdAt?: string }[];
  value: string;
  onChange: (id: string) => void;
  /** The "no campaign" option, e.g. "Choose a campaign…" or "All campaigns". */
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");
  const sorted = useMemo(
    () => [...campaigns].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [campaigns],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? sorted.filter((c) => c.id === value || c.name.toLowerCase().includes(needle))
    : sorted;
  const searchable = campaigns.length > 12;

  return (
    <div className="space-y-1.5">
      {searchable && (
        <label className="flex items-center gap-2 rounded-lg border border-line bg-bg/40 px-2.5 py-1.5 text-xs focus-within:border-accent/60">
          <Search size={13} className="text-muted shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Filter ${campaigns.length} campaigns…`}
            className="w-full bg-transparent text-ink outline-none placeholder:text-muted"
          />
        </label>
      )}
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{needle ? `${emptyLabel} (${shown.filter((c) => c.id !== value).length} match)` : emptyLabel}</option>
        {shown.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </Select>
    </div>
  );
}
