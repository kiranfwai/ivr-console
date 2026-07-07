"use client";

import { Wallet, Hash, Plus } from "lucide-react";
import { Card, Button } from "../ui";

export default function CreditsOverview({
  credits,
  onWallet,
  onPhoneNumbers,
  onAddCredits,
}: {
  credits: number;
  onWallet: () => void;
  onPhoneNumbers: () => void;
  onAddCredits: () => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-bg shadow-glow">
            <Wallet size={26} strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted">Credits remaining</div>
            <div className="text-4xl font-semibold tabular-nums leading-tight mt-0.5">
              {credits.toLocaleString("en-IN")}
            </div>
            <div className="text-xs text-muted mt-1">Available for calls, IVR and messaging</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button variant="ghost" leftIcon={<Wallet size={14} />} onClick={onWallet}>
            Wallet
          </Button>
          <Button variant="ghost" leftIcon={<Hash size={14} />} onClick={onPhoneNumbers}>
            Phone Numbers
          </Button>
          <Button leftIcon={<Plus size={14} />} onClick={onAddCredits}>
            Add Credits
          </Button>
        </div>
      </div>
    </Card>
  );
}
