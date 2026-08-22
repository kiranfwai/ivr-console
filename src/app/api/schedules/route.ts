import { NextRequest, NextResponse } from "next/server";
import { currentClientId } from "@/lib/tenant";
import { readSession } from "@/lib/session";
import { createSchedule, listSchedules, validateSchedule, type CreateScheduleInput } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled runs for this client.
 *
 * Permission is checked per KIND rather than for the route as a whole: a
 * scheduled campaign is a bulk dial and a scheduled blast is a WhatsApp send,
 * so each needs the grant it would need if the user pressed the button
 * themselves. Scheduling must not become a way around a permission.
 */
async function allowed(kind: string): Promise<boolean> {
  const s = await readSession();
  if (!s) return false;
  if (s.role === "admin") return true;
  return s.perms.includes(kind === "whatsapp" ? "whatsapp" : "bulk");
}

export async function GET() {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ schedules: await listSchedules(clientId) });
  } catch (e) {
    console.error("[schedules] list failed:", e);
    return NextResponse.json({ error: "Could not load schedules." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const clientId = currentClientId();
  if (!clientId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as CreateScheduleInput;
  if (!(await allowed(body?.kind))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const problem = validateSchedule(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    return NextResponse.json({ schedule: await createSchedule(clientId, body) });
  } catch (e) {
    console.error("[schedules] create failed:", e);
    return NextResponse.json({ error: "Could not save the schedule." }, { status: 503 });
  }
}
