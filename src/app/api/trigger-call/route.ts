import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/hmac";
import { findCampaignByNameOrId } from "@/lib/campaigns";
import { placeCampaignCall } from "@/lib/place-campaign-call";

export const dynamic = "force-dynamic";

// Strict E.164: leading "+", first digit 1-9, 8-15 digits total.
const E164 = /^\+[1-9]\d{7,14}$/;
// Pragmatic email shape (not full RFC 5322, but rejects the obvious bad ones).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/**
 * POST /api/trigger-call — fire a single campaign call from an external system
 * (curl, automation, etc). Auth is an x-api-key header (never in the URL); the
 * call itself goes out through the same mechanism as the dashboard test call,
 * so it plays the campaign audio and fires the campaign's Pabbly workflow.
 *
 * Body: { "campaign": "<name or id>", "contact": { "name", "phone", "email" } }
 */
export async function POST(req: NextRequest) {
  // --- Auth: x-api-key must match TRIGGER_CALL_API_KEY. Fail closed if unset. ---
  const expected = process.env.TRIGGER_CALL_API_KEY;
  if (!expected) {
    return fail("server not configured (TRIGGER_CALL_API_KEY unset)", 500);
  }
  const provided = req.headers.get("x-api-key") || "";
  if (!constantTimeEqual(provided, expected)) {
    return fail("invalid or missing x-api-key", 401);
  }

  // --- Parse + validate body. Each failure says exactly which field is wrong. ---
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("invalid JSON body", 400);

  const campaignRef = typeof body.campaign === "string" ? body.campaign.trim() : "";
  if (!campaignRef) return fail("campaign is required", 400);

  const contact = body.contact && typeof body.contact === "object" ? body.contact : null;
  if (!contact) return fail("contact is required", 400);

  const name = typeof contact.name === "string" ? contact.name.trim() : "";
  const phone = typeof contact.phone === "string" ? contact.phone.trim() : "";
  const email = typeof contact.email === "string" ? contact.email.trim() : "";

  if (!name) return fail("contact.name is required", 400);
  if (!E164.test(phone)) return fail("contact.phone must be valid E.164, e.g. +919876543210", 400);
  if (!EMAIL.test(email)) return fail("contact.email must be a valid email address", 400);

  // --- Campaign must exist in the dashboard (matched by id or name). ---
  const campaign = await findCampaignByNameOrId(campaignRef);
  if (!campaign) return fail("campaign not found", 400);

  // --- Trigger via the SAME path as the dashboard test call. ---
  const result = await placeCampaignCall({
    campaign,
    phone,
    callerName: name,
    email,
    req,
  });

  if (!result.ok) {
    // Plivo rejected / failed to queue the call — surface it as an upstream error.
    return fail(`telephony provider error (status ${result.status})`, 502, {
      campaign: campaign.name,
      contact: name,
    });
  }

  return NextResponse.json({
    success: true,
    callId: result.callUuid,
    campaign: campaign.name,
    contact: name,
  });
}
