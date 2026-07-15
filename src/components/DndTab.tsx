"use client";

import { useMemo, useState } from "react";
import { Ban, Plus, Trash2, Search, ShieldX } from "lucide-react";
import {
  Button,
  Card,
  Section,
  Textarea,
  Input,
  Label,
  Badge,
  EmptyState,
  CsvFilePicker,
  Spinner,
  toast,
} from "@/components/ui";
import { useFetch, api } from "@/components/useData";

interface DndData {
  numbers: string[];
  count: number;
}

/**
 * Do-Not-Disturb list for the current client. Numbers added here are NEVER
 * dialed — the single call, the external trigger API, and bulk campaigns all
 * skip them, even when the number is present in an uploaded campaign list.
 */
export default function DndTab() {
  const { data, loading, err, reload } = useFetch<DndData>("/api/dnd");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const numbers = data?.numbers ?? [];
  const filtered = useMemo(() => {
    const needle = q.replace(/\s+/g, "");
    if (!needle) return numbers;
    return numbers.filter((n) => n.includes(needle));
  }, [numbers, q]);

  async function add() {
    const raw = input.trim();
    if (!raw) return;
    setBusy(true);
    try {
      const r = await api<{ added: number; count: number }>("/api/dnd", {
        method: "POST",
        body: JSON.stringify({ text: raw }),
      });
      toast(
        r.added > 0
          ? `Added ${r.added} number${r.added === 1 ? "" : "s"} to DND.`
          : "No new numbers added (already on the list).",
        r.added > 0 ? "ok" : "info",
      );
      setInput("");
      reload();
    } catch (e: any) {
      toast(e.message || "Could not add to DND", "danger");
    }
    setBusy(false);
  }

  async function removeOne(num: string) {
    try {
      await api("/api/dnd", { method: "DELETE", body: JSON.stringify({ phones: [num] }) });
      toast(`Removed ${num} from DND.`, "ok");
      reload();
    } catch (e: any) {
      toast(e.message || "Could not remove", "danger");
    }
  }

  async function clearAll() {
    if (!numbers.length) return;
    if (!window.confirm(`Remove all ${numbers.length} numbers from the DND list? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api("/api/dnd", { method: "DELETE", body: JSON.stringify({ all: true }) });
      toast("Cleared the DND list.", "ok");
      reload();
    } catch (e: any) {
      toast(e.message || "Could not clear", "danger");
    }
    setBusy(false);
  }

  return (
    <Section>
      <Card
        title={
          <span className="flex items-center gap-2">
            <Ban size={16} className="text-danger" /> Do Not Disturb
          </span>
        }
        description="Numbers on this list are never called — the single call, the trigger API and bulk campaigns all skip them, even if they appear in an uploaded list."
        action={<Badge tone="danger">{data?.count ?? 0} on list</Badge>}
      >
        <div className="space-y-3">
          <div>
            <Label hint="One per line, or paste comma / space separated. Any format — +91…, 0987…, 98765 43210.">
              Add numbers
            </Label>
            <Textarea
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"+919876543210\n+919812345678"}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button leftIcon={<Plus size={14} />} onClick={add} loading={busy} disabled={!input.trim()}>
              Add to DND
            </Button>
            <CsvFilePicker onLoad={(text) => setInput((prev) => (prev ? prev + "\n" : "") + text)} />
            <span className="text-xs text-muted">
              CSV: the whole file is scanned for phone numbers.
            </span>
          </div>
        </div>
      </Card>

      <Card
        title="Blocked numbers"
        action={
          numbers.length > 0 ? (
            <Button variant="danger" size="sm" leftIcon={<ShieldX size={13} />} onClick={clearAll} disabled={busy}>
              Clear all
            </Button>
          ) : undefined
        }
      >
        {numbers.length > 0 && (
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-2.5 text-muted pointer-events-none z-10" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search numbers…"
              className="pl-9"
            />
          </div>
        )}

        {loading && !data ? (
          <div className="flex justify-center py-10 text-muted">
            <Spinner size={18} />
          </div>
        ) : err ? (
          <div className="text-center py-8 text-sm text-danger">
            Couldn’t load the DND list.{" "}
            <button onClick={reload} className="text-brand underline">
              Retry
            </button>
          </div>
        ) : numbers.length === 0 ? (
          <EmptyState
            icon={<Ban size={20} />}
            title="No numbers on the DND list"
            description="Add numbers above to make sure they’re never called by this client."
          />
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted">No numbers match “{q}”.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {filtered.map((num) => (
              <div
                key={num}
                className="group flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/50 px-3 py-1.5"
              >
                <span className="font-mono text-sm tabular-nums truncate">{num}</span>
                <button
                  onClick={() => removeOne(num)}
                  title="Remove from DND"
                  aria-label={`Remove ${num}`}
                  className="shrink-0 text-muted hover:text-danger transition-colors opacity-60 group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {numbers.length > 0 && filtered.length > 0 && q && (
          <div className="mt-2 text-xs text-muted">
            Showing {filtered.length} of {numbers.length}.
          </div>
        )}
      </Card>
    </Section>
  );
}
