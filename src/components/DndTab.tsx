"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Plus, Trash2, Search, ShieldX, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Button,
  Section,
  Textarea,
  Input,
  Label,
  Badge,
  EmptyState,
  CsvFilePicker,
  Spinner,
  Modal,
  ConfirmDialog,
  DataPanel,
  toast,
} from "@/components/ui";
import { api } from "@/components/useData";

interface DndPage {
  numbers: string[];
  /** Size of the whole list, ignoring any search. */
  total: number;
  /** How many match the current search (equals `total` when not searching). */
  matched: number;
}

const PAGE = 50;

/**
 * Do-Not-Disturb list for the current client. Numbers here are NEVER dialed —
 * the single call, the external trigger API and bulk campaigns all skip them,
 * even when the number appears in an uploaded list.
 *
 * Two things changed in the restructure:
 *
 *  1. The list is PAGED. It used to fetch every number and render one node per
 *     number; a 50,000-row scrub list — exactly what this page is for — froze
 *     the browser. Search still runs across the whole list, server-side.
 *
 *  2. Adding numbers moved into a dialog, so the paste box and CSV picker stop
 *     occupying the top of the screen when you only came to look something up.
 */
export default function DndTab() {
  const [page, setPage] = useState<DndPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (off: number, needle: string) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(off) });
      if (needle.trim()) p.set("q", needle.trim());
      const r = await api<DndPage>(`/api/dnd?${p.toString()}`);
      setPage(r);
      setErr(false);
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(offset, debouncedQ);
  }, [load, offset, debouncedQ]);

  // Debounce typing so each keystroke doesn't hit the server.
  function onSearch(v: string) {
    setQ(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setOffset(0);
      setDebouncedQ(v);
    }, 250);
  }

  async function removeOne(num: string) {
    try {
      await api("/api/dnd", { method: "DELETE", body: JSON.stringify({ phones: [num] }) });
      toast(`Removed ${num} from DND.`, "ok");
      // Step back a page if that was the last row on this one.
      const nextOffset = page && page.numbers.length === 1 && offset > 0 ? offset - PAGE : offset;
      setOffset(nextOffset);
      load(nextOffset, debouncedQ);
    } catch (e: any) {
      toast(e.message || "Could not remove", "danger");
    }
  }

  async function clearAll() {
    setBusy(true);
    try {
      await api("/api/dnd", { method: "DELETE", body: JSON.stringify({ all: true }) });
      toast("Cleared the DND list.", "ok");
      setOffset(0);
      load(0, debouncedQ);
    } catch (e: any) {
      toast(e.message || "Could not clear", "danger");
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  }

  const total = page?.total ?? 0;
  const matched = page?.matched ?? 0;
  const searching = debouncedQ.trim().length > 0;
  const shown = page?.numbers ?? [];
  const from = matched === 0 ? 0 : offset + 1;
  const to = offset + shown.length;
  const lastPage = Math.max(0, Math.ceil(matched / PAGE) - 1);
  const pageNo = Math.floor(offset / PAGE);

  return (
    <Section>
      <DataPanel
        title={
          <span className="flex items-center gap-2">
            <Ban size={15} className="text-danger" /> Blocked numbers
          </span>
        }
        meta="never called or messaged — no call, bulk, sheet, trigger API or WhatsApp"
        action={
          <>
            <Badge tone="danger">{total.toLocaleString()} on list</Badge>
            {total > 0 && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<ShieldX size={13} />}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </Button>
            )}
            <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => setAddOpen(true)}>
              Add numbers
            </Button>
          </>
        }
        footer={
          matched > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span>
                Showing {from.toLocaleString()}–{to.toLocaleString()} of {matched.toLocaleString()}
                {searching && <> matching “{debouncedQ}” (of {total.toLocaleString()} total)</>}
              </span>
              {lastPage > 0 && (
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pageNo === 0 || loading}
                    onClick={() => setOffset(Math.max(0, offset - PAGE))}
                    leftIcon={<ChevronLeft size={13} />}
                  >
                    Prev
                  </Button>
                  <span className="px-1 tabular-nums">
                    {pageNo + 1} / {lastPage + 1}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pageNo >= lastPage || loading}
                    onClick={() => setOffset(offset + PAGE)}
                    rightIcon={<ChevronRight size={13} />}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          ) : undefined
        }
      >
        <div className="px-4 pt-4">
          <div className="relative max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-2.5 z-10 text-muted" />
            <Input
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search the whole list…"
              className="pl-9"
            />
          </div>
        </div>

        {loading && !page ? (
          <div className="flex justify-center py-14 text-muted">
            <Spinner size={18} />
          </div>
        ) : err ? (
          <div className="py-10 text-center text-sm text-danger">
            Couldn’t load the DND list.{" "}
            <button onClick={() => load(offset, debouncedQ)} className="text-brand underline">
              Retry
            </button>
          </div>
        ) : total === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Ban size={20} />}
              title="No numbers on the DND list"
              description="Add numbers and they will never be called or sent a WhatsApp by this client — however they were typed."
            />
          </div>
        ) : shown.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            No numbers match “{debouncedQ}”.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((num) => (
              <div
                key={num}
                className="group flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.022] px-3 py-1.5"
              >
                <span className="truncate font-mono text-sm tabular-nums">{num}</span>
                <button
                  onClick={() => removeOne(num)}
                  title="Remove from DND"
                  aria-label={`Remove ${num}`}
                  className="shrink-0 text-muted opacity-60 transition-colors hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </DataPanel>

      <AddNumbersModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false);
          setOffset(0);
          load(0, debouncedQ);
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Clear the whole DND list"
        busy={busy}
        confirmLabel="Clear the list"
        typeToConfirm={String(total)}
        body={
          <>
            This removes <span className="font-medium text-ink">all {total.toLocaleString()} numbers</span>{" "}
            from the list. Every one of them becomes callable again, immediately, including by campaigns that
            are already running. There is no undo and no backup.
          </>
        }
        onConfirm={clearAll}
        onClose={() => setConfirmClear(false)}
      />
    </Section>
  );
}

/** Paste or upload numbers. Same inputs as before, no longer parked on the page. */
function AddNumbersModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setInput("");
  }, [open]);

  // Mirror of the server's rule, purely so the count shown before you commit
  // matches what will actually be stored.
  const preview = useMemo(() => {
    const chunks = input.split(/[\r\n,;\t|]+/g).map((c) => c.trim()).filter(Boolean);
    return chunks.filter((c) => /\d/.test(c)).length;
  }, [input]);

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
          : "No new numbers added — they were already on the list.",
        r.added > 0 ? "ok" : "info",
      );
      onAdded();
    } catch (e: any) {
      toast(e.message || "Could not add to DND", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add numbers to DND"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} loading={busy} disabled={!input.trim()} leftIcon={<Plus size={14} />}>
            Add {preview > 0 ? `${preview} number${preview === 1 ? "" : "s"}` : "to DND"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label hint="One per line, or comma separated">Numbers</Label>
          <Textarea
            rows={7}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"+91 88255 74083\n+91 98200 38609\n9876543210"}
            autoFocus
          />
        </div>
        <div className="rounded-lg border border-brand/25 bg-brand/[0.06] px-3 py-2 text-xs text-[#a9f2e8]">
          Spaces inside a number are fine — <span className="font-mono">+91 88255 74083</span> is read as one
          number, not three. Put each number on its own line, or separate them with commas.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvFilePicker onLoad={(text) => setInput((prev) => (prev ? prev + "\n" : "") + text)} />
          <span className="text-xs text-muted">CSV: the whole file is scanned for phone numbers.</span>
        </div>
      </div>
    </Modal>
  );
}
