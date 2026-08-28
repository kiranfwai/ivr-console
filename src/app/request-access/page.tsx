import type { Metadata } from "next";
import RequestAccess from "@/components/landing/RequestAccess";

export const metadata: Metadata = {
  title: "Request access",
  description:
    "Tell us what you want to dial and the FWAI team will get back to you within a working day.",
  robots: { index: true, follow: true },
};

export default function RequestAccessPage() {
  return <RequestAccess />;
}
