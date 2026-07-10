"use client";

// Loads Cashfree's Drop-in JS SDK on demand and opens hosted checkout. The SDK
// is only fetched when the user actually starts a top-up (keeps it off the
// critical path for everyone else).

declare global {
  interface Window {
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => {
      checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => Promise<unknown>;
    };
  }
}

const SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";
let loading: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window !== "undefined" && window.Cashfree) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("Could not load the payment SDK. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Open Cashfree checkout for a payment session; redirects the current tab. */
export async function startCheckout(
  paymentSessionId: string,
  env: "sandbox" | "production",
): Promise<void> {
  await loadSdk();
  if (!window.Cashfree) throw new Error("Payment SDK unavailable.");
  const cashfree = window.Cashfree({ mode: env });
  await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
}
