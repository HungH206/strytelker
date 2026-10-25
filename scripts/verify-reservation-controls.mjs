import assert from "node:assert/strict";
import express from "express";
import { createToyoRouter } from "../server/toyo-api.mjs";
import { createReservationStore } from "../server/reservations.mjs";
const store = createReservationStore(":memory:");
let armed;
const bridge = {
  status: () => ({ connected: true }),
  disarm() {
    armed = null;
  },
  arm(callback) {
    armed = callback;
    return "a".repeat(24);
  },
};
const ai = {
  authTokens: { create: async () => ({ name: "auth_tokens/mock" }) },
};
const app = express();
app.use(express.json());
app.use("/api/toyo", createToyoRouter(ai, bridge, undefined, undefined, store));
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}/api/toyo`;
try {
  for (const mode of ["browser", "local", "voice"]) {
    let token, state;
    async function request(path, body, expected = 200) {
      const res = await fetch(`${base}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Journey-Token": token || "",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      assert.equal(res.status, expected, JSON.stringify(data));
      return data;
    }
    const session = await request("sessions", {});
    token = session.token;
    state = session.state;
    const post = (path, body = {}, expected = 200) =>
      request(path, { revision: state.revision, ...body }, expected);
    const event = async (event) => {
      state = await post("event", { event });
    };
    await post("reservation", {}, 409);
    await event({ type: "PROFILE", profile: { kind: "Sedan", range: 0 } });
    await event({ type: "CHOOSE_CAR" });
    await event({
      type: "FINANCE",
      finance: {
        method: "loan",
        savings: 8000,
        reserve: 2000,
        monthlyBudget: 1000,
        ownershipCosts: 150,
        downPayment: 5000,
        apr: 6.5,
        months: 60,
      },
    });
    await event({
      type: "INSURANCE",
      insurance: { mode: "included", monthly: 0, accepted: true },
    });
    await event({ type: "CONFIRM" });
    await post("browser-serial/arm", {}, 409);
    const lease = await post("voice/token");
    let call = 0;
    const tool = (name, args, expected = 200) =>
      post(
        "voice/tool",
        {
          voiceSessionId: lease.voiceSessionId,
          callId: `call-${++call}`,
          name,
          args: { revision: state.revision, ...args },
        },
        expected,
      );
    await tool("save_reservation", { userConfirmed: true }, 400);
    const draft = await tool("prepare_reservation", {
      name: "Voice Test",
      phone: "+15551234567",
    });
    await post(
      "reservation/prepare",
      {
        reviewed: true,
        contact: { name: "Voice Test", phone: "+15551234567", consent: true },
      },
      400,
    );
    const filled = await tool("confirm_details", {
      draftId: draft.draft.id,
      userConfirmed: true,
    });
    state = filled.state;
    assert.equal(filled.reservationContact.name, "Voice Test");
    const contact = {
      name: filled.reservationContact.name,
      phone: filled.reservationContact.phone,
      consent: true,
    };
    await post(
      "reservation/prepare",
      { contact: { ...contact, consent: false }, reviewed: true },
      400,
    );
    state = await post("reservation/prepare", { contact, reviewed: true });
    const stale = await post("browser-serial/arm");
    state = await post("reservation/cancel");
    await post("browser-serial/press", { nonce: stale.nonce, count: 1 }, 409);
    state = await post("reservation/prepare", { contact, reviewed: true });
    if (mode === "voice") {
      await tool("save_reservation", { userConfirmed: false }, 400);
      const arm = await post("browser-serial/arm");
      const saved = await tool("save_reservation", { userConfirmed: true });
      state = saved.state;
      assert.equal(
        saved.reservationSubmission.savedReference,
        state.reservationId,
      );
      assert.equal(
        (await store.get(token)).reservationSubmissionSource,
        "voice",
      );
      await post("browser-serial/press", { nonce: arm.nonce, count: 1 }, 409);
      await tool("save_reservation", { userConfirmed: true }, 400);
    } else if (mode === "browser") {
      const originalSave = store.save;
      const originalError = console.error;
      const diagnostics = [];
      try {
        store.save = () => {
          throw Object.assign(new Error("private database credentials"), {
            code: "ECONNREFUSED",
          });
        };
        console.error = (...args) => diagnostics.push(args);
        const failed = await post("reservation", {}, 503);
        assert.match(failed.error, /storage is unavailable/);
        assert.ok(!failed.error.includes("private database credentials"));
        assert.deepEqual(diagnostics, [
          ["Reservation storage save failed", { code: "ECONNREFUSED" }],
        ]);
        const retained = await request("session");
        assert.equal(retained.revision, state.revision);
        assert.equal(retained.reservationReady, true);
        assert.ok(!retained.reservationId);
      } finally {
        store.save = originalSave;
        console.error = originalError;
      }
      let arm = await post("browser-serial/arm");
      assert.equal(arm.gestures, false);
      await post("browser-serial/press", { nonce: arm.nonce, count: 2 }, 409);
      arm = await post("browser-serial/arm");
      const oldRevision = state.revision;
      state = await post("browser-serial/press", {
        nonce: arm.nonce,
        count: 1,
      });
      await request(
        "browser-serial/press",
        { revision: oldRevision, nonce: arm.nonce, count: 1 },
        409,
      );
    } else {
      await post("hardware/arm");
      const callback = armed;
      await callback(1);
      state = await request("session");
      await callback(1); // old hardware callback cannot submit a second time
    }
    assert.ok(state.reservationId);
    assert.equal(state.reservationReady, false);
    assert.equal((await store.get(token)).customer.name, "Voice Test");
    await tool(
      "prepare_reservation",
      { name: "Change", phone: "+15551234567" },
      400,
    );
    const receipt = await request("reservation/export");
    assert.equal(receipt.id, state.reservationId);
    console.log(
      `${mode}: voice dictation/readback, consent/review, stale/double press rejection, single-press save and export passed.`,
    );
  }
  assert.equal(store.list().length, 3);
} finally {
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
