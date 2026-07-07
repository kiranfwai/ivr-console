"use client";

import { useState } from "react";
import { Card, Section } from "./ui";
import CreditsOverview from "./billing/CreditsOverview";
import TransactionTable from "./billing/TransactionTable";
import AddCreditsModal from "./billing/AddCreditsModal";
import WalletPage from "./billing/WalletPage";
import PhoneNumbersPage from "./billing/PhoneNumbersPage";
import { MOCK_TRANSACTIONS, MOCK_CREDITS_REMAINING } from "./billing/mock";

// Billing has three sub-views. Rather than add extra sidebar entries, the
// Wallet and Phone Numbers pages are reached from the overview's buttons and
// swap in here (mirrors how the app keeps one nav item per area).
type View = "overview" | "wallet" | "numbers";

export default function BillingTab() {
  const [view, setView] = useState<View>("overview");
  const [addOpen, setAddOpen] = useState(false);

  if (view === "wallet") return <WalletPage onBack={() => setView("overview")} />;
  if (view === "numbers") return <PhoneNumbersPage onBack={() => setView("overview")} />;

  return (
    <Section>
      <CreditsOverview
        credits={MOCK_CREDITS_REMAINING}
        onWallet={() => setView("wallet")}
        onPhoneNumbers={() => setView("numbers")}
        onAddCredits={() => setAddOpen(true)}
      />

      <Card title="Transaction History" description="Credit top-ups, usage, adjustments and refunds">
        <TransactionTable transactions={MOCK_TRANSACTIONS} />
      </Card>

      <AddCreditsModal open={addOpen} onClose={() => setAddOpen(false)} />
    </Section>
  );
}
