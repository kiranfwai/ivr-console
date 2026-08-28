/**
 * Billing identity test — the structured details that go on a tax invoice.
 *
 * What actually matters here is not the form, it is what the form is allowed to
 * store:
 *   - a GSTIN decides the state, because its first two digits ARE the state
 *     code; a hand-picked state that disagrees is overridden, not kept;
 *   - the parts compose into the ONE address string the PDF prints, so nothing
 *     downstream has to learn about line 1 and line 2;
 *   - the whole block stays optional for a customer, but a HALF-filled address
 *     is refused — an address with no PIN cannot go on a tax document;
 *   - a malformed GSTIN or PAN is refused outright, with a 400 and the field
 *     name, never a 503;
 *   - a shipping address is captured and NEVER changes the tax: the place of
 *     supply is still the billing state;
 *   - our own seller details cannot start issuing until they are complete.
 *
 * Restores everything it touched.
 *
 * Usage (local sandbox DB running):
 *   1. npm run dev
 *   2. node scripts/test-billing-details.mjs
 */

const APP = process.env.APP_URL || "http://localhost:3000";
const ADMIN = { email: "admin@local", password: "localdev" };
const CLIENT = { email: "test@local", password: "testlocal" };

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log("  PASS  " + label); }
  else {
    failed++;
    console.log("  FAIL  " + label);
    console.log("        expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function makeSession() {
  let cookie = "";
  return {
    async raw(p, init = {}) {
      const headers = { "content-type": "application/json", ...(init.headers || {}) };
      if (cookie) headers.cookie = cookie;
      const res = await fetch(APP + p, { ...init, headers });
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      return res;
    },
    async api(p, init = {}) {
      const res = await this.raw(p, init);
      const t = await res.text();
      let b; try { b = JSON.parse(t); } catch { b = t; }
      if (!res.ok) { const e = new Error(`${init.method || "GET"} ${p} -> ${res.status} ${t.slice(0, 140)}`); e.status = res.status; e.body = b; throw e; }
      return b;
    },
    login(c) { return this.api("/api/auth/login", { method: "POST", body: JSON.stringify(c) }); },
  };
}

/** PUT that is expected to be refused — returns { status, error, field }. */
async function expectReject(session, body) {
  const res = await session.raw("/api/wallet/billing-details", {
    method: "PUT", body: JSON.stringify(body),
  });
  const b = await res.json().catch(() => ({}));
  return { status: res.status, field: b.field };
}

const FULL = {
  legalName: "Acme Private Limited",
  gstin: "29AABCF1234M1Z7",
  pan: "AABCF1234M",
  billingEmail: "accounts@acme.test",
  phone: "9876543210",
  line1: "3rd Floor, Prestige Tower",
  line2: "Outer Ring Road",
  city: "Bengaluru",
  state: "Karnataka",
  stateCode: "29",
  pincode: "560103",
  shipSame: true,
};

const BLANK = {
  legalName: "", gstin: "", pan: "", billingEmail: "", phone: "",
  line1: "", line2: "", city: "", state: "", stateCode: "", pincode: "",
  shipSame: true, shipLine1: "", shipLine2: "", shipCity: "", shipState: "", shipPincode: "",
};

async function main() {
  const client = makeSession();
  const admin = makeSession();
  await client.login(CLIENT);
  await admin.login(ADMIN);

  const originalBuyer = (await client.api("/api/wallet/billing-details")).details;
  const originalSeller = (await admin.api("/api/admin/invoicing")).settings;

  try {
    console.log("\n-- customer: a complete identity --");
    let d = (await client.api("/api/wallet/billing-details", {
      method: "PUT", body: JSON.stringify(FULL),
    })).details;
    check("legal name stored", d.legalName, "Acme Private Limited");
    check("PAN stored", d.pan, "AABCF1234M");
    check("billing email stored", d.billingEmail, "accounts@acme.test");
    check("phone stored", d.phone, "9876543210");
    check("line 1 stored", d.line1, "3rd Floor, Prestige Tower");
    check("line 2 stored", d.line2, "Outer Ring Road");
    check("city stored", d.city, "Bengaluru");
    check("PIN stored", d.pincode, "560103");
    check(
      "the parts compose into the printed address",
      d.address,
      "3rd Floor, Prestige Tower, Outer Ring Road, Bengaluru, Karnataka 560103",
    );
    check("a re-read returns the same thing", (await client.api("/api/wallet/billing-details")).details.address, d.address);

    console.log("\n-- customer: the GSTIN decides the state --");
    d = (await client.api("/api/wallet/billing-details", {
      method: "PUT",
      body: JSON.stringify({ ...FULL, gstin: "27AABCF1234M1Z1", state: "Karnataka", stateCode: "29" }),
    })).details;
    check("state overridden from the GSTIN", d.state, "Maharashtra");
    check("state code overridden from the GSTIN", d.stateCode, "27");
    check("the composed address carries the derived state", d.address.includes("Maharashtra"), true);

    console.log("\n-- customer: what is refused --");
    check("malformed GSTIN", await expectReject(client, { ...FULL, gstin: "29AABCF1234M" }), { status: 400, field: "gstin" });
    check("malformed PAN", await expectReject(client, { ...FULL, pan: "AABCF1234" }), { status: 400, field: "pan" });
    check("five-digit PIN", await expectReject(client, { ...FULL, pincode: "56010" }), { status: 400, field: "pincode" });
    check("PIN starting with zero", await expectReject(client, { ...FULL, pincode: "060103" }), { status: 400, field: "pincode" });
    check("nonsense billing email", await expectReject(client, { ...FULL, billingEmail: "not-an-email" }), { status: 400, field: "billingEmail" });
    check("address with no city", await expectReject(client, { ...FULL, city: "" }), { status: 400, field: "city" });
    check("address with no PIN", await expectReject(client, { ...FULL, pincode: "" }), { status: 400, field: "pincode" });
    check(
      "address with no state and no GSTIN to derive one from",
      await expectReject(client, { ...FULL, gstin: "", state: "", stateCode: "" }),
      { status: 400, field: "state" },
    );

    console.log("\n-- customer: blank stays legal --");
    d = (await client.api("/api/wallet/billing-details", { method: "PUT", body: JSON.stringify(BLANK) })).details;
    check("everything can be cleared", [d.gstin, d.address, d.line1, d.city, d.pincode], ["", "", "", "", ""]);
    d = (await client.api("/api/wallet/billing-details", {
      method: "PUT", body: JSON.stringify({ ...BLANK, gstin: "29AABCF1234M1Z7" }),
    })).details;
    check("a GSTIN on its own is accepted", d.gstin, "29AABCF1234M1Z7");
    check("and still fills in the state", [d.state, d.stateCode], ["Karnataka", "29"]);
    check("without inventing an address", d.address, "");

    console.log("\n-- customer: a one-line address from before this existed --");
    d = (await client.api("/api/wallet/billing-details", {
      method: "PUT",
      body: JSON.stringify({
        gstin: "29AABCF1234M1Z7",
        address: "402, Lakeview Chambers, Andheri East",
        city: "Bengaluru", pincode: "560103",
      }),
    })).details;
    check("becomes line 1 rather than being split by guesswork", d.line1, "402, Lakeview Chambers, Andheri East");

    console.log("\n-- customer: shipping is captured, and changes no tax --");
    const ship = {
      ...FULL,
      shipSame: false,
      shipLine1: "Warehouse 4, Bommasandra",
      shipLine2: "",
      shipCity: "Hosur",
      shipState: "Tamil Nadu",
      shipPincode: "635109",
    };
    d = (await client.api("/api/wallet/billing-details", { method: "PUT", body: JSON.stringify(ship) })).details;
    check("shipping address stored", [d.shipping.same, d.shipping.city, d.shipping.state], [false, "Hosur", "Tamil Nadu"]);
    check("the billing address is untouched by it", d.address.includes("Bengaluru, Karnataka 560103"), true);
    check("and the place of supply is still the BILLING state", [d.state, d.stateCode], ["Karnataka", "29"]);
    check(
      "half a shipping address is refused",
      await expectReject(client, { ...ship, shipPincode: "" }),
      { status: 400, field: "shipPincode" },
    );
    d = (await client.api("/api/wallet/billing-details", {
      method: "PUT",
      body: JSON.stringify({ ...FULL, shipSame: false }),
    })).details;
    check("'not the same' with nothing typed is just 'the same'", d.shipping.same, true);

    console.log("\n-- our own details: not ready until they are complete --");
    let cfg = await admin.api("/api/admin/invoicing", {
      method: "PUT",
      body: JSON.stringify({
        ...originalSeller, enabled: true,
        legalName: "Freedom With AI Technologies Private Limited",
        gstin: "29AABCF1234M1Z7", pan: "AABCF1234M",
        line1: "3rd Floor, Prestige Tower", line2: "", city: "", pincode: "",
        state: "", stateCode: "",
      }),
    });
    check("city and PIN are named as missing", cfg.missing, ["City", "PIN code"]);
    check("so nothing is issued", cfg.issuing, false);

    cfg = await admin.api("/api/admin/invoicing", {
      method: "PUT",
      body: JSON.stringify({
        ...originalSeller, enabled: true,
        legalName: "Freedom With AI Technologies Private Limited",
        gstin: "29AABCF1234M1Z7", pan: "AABCF1234M",
        line1: "3rd Floor, Prestige Tower", line2: "Outer Ring Road",
        city: "Bengaluru", pincode: "560103",
      }),
    });
    check("nothing missing once it is complete", cfg.missing, []);
    check("and it starts issuing", cfg.issuing, true);
    check("the state came from our GSTIN too", [cfg.settings.state, cfg.settings.stateCode], ["Karnataka", "29"]);
    check(
      "our address composes the same way",
      cfg.settings.address,
      "3rd Floor, Prestige Tower, Outer Ring Road, Bengaluru, Karnataka 560103",
    );

    cfg = await admin.api("/api/admin/invoicing", {
      method: "PUT",
      body: JSON.stringify({ ...cfg.settings, gstin: "29AABCF1234M" }),
    });
    check("a malformed GSTIN stops issuing rather than printing it", cfg.issuing, false);
    check("and says why", cfg.missing.includes("a valid GSTIN"), true);
  } finally {
    console.log("\n-- restoring --");
    const restore = {
      legalName: originalBuyer.legalName === originalBuyer.name ? "" : originalBuyer.legalName,
      gstin: originalBuyer.gstin,
      pan: originalBuyer.pan || "",
      address: originalBuyer.address,
      line1: originalBuyer.line1 || "",
      line2: originalBuyer.line2 || "",
      city: originalBuyer.city || "",
      pincode: originalBuyer.pincode || "",
      state: originalBuyer.state,
      stateCode: originalBuyer.stateCode,
      billingEmail: originalBuyer.billingEmail || "",
      phone: originalBuyer.phone || "",
      shipSame: originalBuyer.shipping ? originalBuyer.shipping.same : true,
      shipLine1: originalBuyer.shipping?.line1 || "",
      shipLine2: originalBuyer.shipping?.line2 || "",
      shipCity: originalBuyer.shipping?.city || "",
      shipState: originalBuyer.shipping?.state || "",
      shipPincode: originalBuyer.shipping?.pincode || "",
    };
    await client.api("/api/wallet/billing-details", { method: "PUT", body: JSON.stringify(restore) })
      .catch(async () => {
        // The row predates these rules and is a half-address the API now
        // refuses. Put back everything that IS still valid rather than leaving
        // the test's own data behind.
        console.log("  (the original address was incomplete — restoring everything else)");
        await client.api("/api/wallet/billing-details", {
          method: "PUT",
          body: JSON.stringify({ ...restore, address: "", line1: "", line2: "", city: "", pincode: "" }),
        }).catch((e) => console.log("  (customer restore skipped: " + e.message + ")"));
      });
    await admin.api("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(originalSeller) })
      .catch((e) => console.log("  (seller restore skipped: " + e.message + ")"));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
