"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Plus, Trash2, Search } from "lucide-react";
import {
  Button,
  IconButton,
  Section,
  Textarea,
  Label,
  KPI,
  EmptyState,
  CsvFilePicker,
  Loading,
  Modal,
  ConfirmDialog,
  DataTable,
  TH,
  TD,
  toast,
} from "@/components/ui";
import { api } from "@/components/useData";
import { formatPhone } from "@/lib/phone";
import { Pager, SearchField } from "./CampaignsKit";

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI
          label="On the list"
          value={page ? total.toLocaleString() : "—"}
          sub="never called or messaged"
          icon={<Ban size={17} />}
          tone="danger"
        />
        {searching && (
          <KPI
            label="Match your search"
            value={matched.toLocaleString()}
            sub={`for “${debouncedQ.trim()}”`}
            icon={<Search size={17} />}
            tone="accent"
          />
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">
        <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
          <SearchField
            value={q}
            onChange={onSearch}
            placeholder="Search the whole list…"
            className="min-w-0 flex-1 sm:w-[320px] sm:flex-none"
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {total > 0 && (
              <Button variant="ghost" leftIcon={<Trash2 size={14} />} onClick={() => setConfirmClear(true)}>
                Clear all
              </Button>
            )}
            <Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
              Add numbers
            </Button>
          </div>
        </div>

        {loading && !page ? (
          <Loading py="py-14" />
        ) : err ? (
          <div className="border-t border-line py-10 text-center text-sm text-danger">
            Couldn’t load the Do not disturb list.{" "}
            <button onClick={() => load(offset, debouncedQ)} className="text-accent underline">
              Retry
            </button>
          </div>
        ) : total === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<Ban size={20} />}
              title="No numbers on the list"
              description="Add numbers and they will never be called or sent a WhatsApp — however they were typed."
              action={<Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add numbers</Button>}
            />
          </div>
        ) : shown.length === 0 ? (
          <div className="border-t border-line py-12 text-center text-sm text-muted">No numbers match “{debouncedQ}”.</div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Number</th>
                <th className={`${TH} hidden sm:table-cell`}>Stored as</th>
                <th className={`${TH} w-[60px]`} />
              </tr>
            </thead>
            <tbody className={loading ? "opacity-60 transition-opacity" : ""}>
              {shown.map((num) => (
                <tr key={num} className="group transition-colors hover:bg-ink/[0.022]">
                  <td className={`${TD} whitespace-nowrap font-medium text-ink tabular-nums`}>{formatPhone(num)}</td>
                  <td className={`${TD} hidden font-mono text-[12.5px] text-muted sm:table-cell`}>{num}</td>
                  <td className={`${TD} text-right`}>
                    <IconButton
                      size="sm"
                      variant="danger"
                      icon={<Trash2 size={14} />}
                      title="Remove from Do not disturb"
                      aria-label={`Remove ${num}`}
                      onClick={() => removeOne(num)}
                      className="transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {matched > 0 && !err && (
          <Pager
            page={pageNo}
            pages={lastPage + 1}
            from={from}
            to={to}
            total={matched}
            disabled={loading}
            onPage={(p) => setOffset(p * PAGE)}
            extra={searching ? <> matching “{debouncedQ}” (of {total.toLocaleString()} on the list)</> : undefined}
          />
        )}
      </div>

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
        title="Clear the whole Do not disturb list"
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
      title="Add numbers to Do not disturb"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} loading={busy} disabled={!input.trim()} leftIcon={<Plus size={14} />}>
            Add {preview > 0 ? `${preview} number${preview === 1 ? "" : "s"}` : "numbers"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink2">These numbers will never be called or messaged.</p>
        <div>
          <Label hint="one per line, or comma separated">Numbers</Label>
          <Textarea
            rows={7}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"+91 88255 74083\n+91 98200 38609\n9876543210"}
            autoFocus
          />
        </div>
        <div className="text-xs text-muted">
          {preview > 0 ? `${preview} number${preview === 1 ? "" : "s"} found · ` : ""}
          Spaces inside a number are fine — <span className="font-mono">+91 88255 74083</span> is read as one
          number, not three.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CsvFilePicker onLoad={(text) => setInput((prev) => (prev ? prev + "\n" : "") + text)} />
          <span className="text-xs text-muted">Or upload a CSV — the whole file is scanned for phone numbers.</span>
        </div>
      </div>
    </Modal>
  );
}
