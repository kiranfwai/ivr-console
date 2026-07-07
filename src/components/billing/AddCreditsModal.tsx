"use client";

import { useMemo, useState } from "react";
import { Modal, Button, Input, Label, toast } from "../ui";
import {
  CREDIT_RATE_INR,
  GST_RATE,
  MIN_CREDITS,
  MAX_CREDITS,
  DEFAULT_CREDITS,
  priceBreakdown,
  formatINR,
} from "./config";

export default function AddCreditsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [credits, setCredits] = useState(String(DEFAULT_CREDITS));
  const [phone, setPhone] = useState("");

  const creditsNum = Number(credits);
  const creditsValid =
    Number.isInteger(creditsNum) && creditsNum >= MIN_CREDITS && creditsNum <= MAX_CREDITS;
  const phoneValid = phone.trim().length >= 8;

  const creditsError =
    credits === "" || creditsValid
      ? undefined
      : !Number.isInteger(creditsNum)
      ? "Enter a whole number of credits."
      : creditsNum < MIN_CREDITS
      ? `Minimum ${MIN_CREDITS} credits.`
      : `Maximum ${MAX_CREDITS.toLocaleString("en-IN")} credits.`;

  // Breakdown reflects a valid amount; falls back to 0 while the field is empty/invalid.
  const { base, gst, total } = useMemo(
    () => priceBreakdown(creditsValid ? creditsNum : 0),
    [creditsValid, creditsNum],
  );

  const canPay = creditsValid && phoneValid;

  function handleClose() {
    // Reset to defaults so the next open starts clean.
    setCredits(String(DEFAULT_CREDITS));
    setPhone("");
    onClose();
  }

  function handlePay() {
    if (!canPay) return;
    // Payment gateway integration is not wired up yet (mock).
    toast(
      `Payment of ${formatINR(total)} for ${creditsNum.toLocaleString("en-IN")} credits — gateway coming soon.`,
      "info",
    );
    handleClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add Credits"
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handlePay} disabled={!canPay}>
            Pay {formatINR(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label hint={`${MIN_CREDITS}–${MAX_CREDITS.toLocaleString("en-IN")}`}>Number of Credits</Label>
          <Input
            type="number"
            inputMode="numeric"
            min={MIN_CREDITS}
            max={MAX_CREDITS}
            step={1}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            error={creditsError}
            placeholder={String(DEFAULT_CREDITS)}
          />
        </div>

        <div>
          <Label required>Phone Number</Label>
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            hint="Required by payment gateway"
          />
        </div>

        {/* Live price breakdown */}
        <div className="rounded-xl border border-line bg-bg/50 p-4 space-y-2 text-sm">
          <Row
            label={`Credits price`}
            hint={`${creditsValid ? creditsNum.toLocaleString("en-IN") : 0} × ${formatINR(CREDIT_RATE_INR)}`}
            value={formatINR(base)}
          />
          <Row label={`GST (${Math.round(GST_RATE * 100)}%)`} value={formatINR(gst)} />
          <div className="h-px bg-line my-1" />
          <div className="flex items-center justify-between">
            <span className="font-medium text-ink">Total payable</span>
            <span className="font-semibold tabular-nums text-ink">{formatINR(total)}</span>
          </div>
        </div>

        <p className="text-xs text-muted">GST is applied as per Indian tax regulations.</p>
      </div>
    </Modal>
  );
}

function Row({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink2">
        {label}
        {hint && <span className="text-muted"> · {hint}</span>}
      </span>
      <span className="font-mono tabular-nums text-ink2">{value}</span>
    </div>
  );
}
