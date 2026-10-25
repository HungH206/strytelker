import test from "node:test";
import assert from "node:assert/strict";
import {
  createVoiceService,
  executeVoiceTool,
  TOYO_VOICE_INSTRUCTIONS,
  voiceTools,
} from "../server/voice-agent.mjs";
import {
  createShoppingSession,
  shoppingTransition,
} from "../server/toyo-engine.mjs";
const finance = {
  revision: 2,
  method: "loan",
  savings: 8000,
  reserve: 2000,
  monthlyBudget: 700,
  ownershipCosts: 150,
  downPayment: 5000,
  apr: 6.5,
  months: 60,
  offerId: "college-500",
  eligibilityAcknowledged: true,
};
function sessionAtFinance() {
  let state = shoppingTransition(createShoppingSession(), {
    type: "PROFILE",
    profile: { kind: "Sedan", range: 0 },
  });
  state = shoppingTransition(state, { type: "CHOOSE_CAR" });
  return { state };
}

test("voice instruction covers all four offices, explicit activation controls and user-operated confirmation", () => {
  for (const phrase of [
    "AGENT HQ",
    "GARAGE STASH",
    "FINANCIAL DISTRICT",
    "PAYMENT + INSURANCE",
    "one press",
    "two quick presses",
    "Read back",
    "Never infer final confirmation",
    "voice confirmation backup",
  ])
    assert.ok(TOYO_VOICE_INSTRUCTIONS.includes(phrase));
  assert.ok(
    !voiceTools.some((tool) =>
      /purchase|choose_vehicle|CONFIRM/.test(tool.name),
    ),
  );
});

test("ephemeral token locks seller instructions and tools without returning the permanent key", async () => {
  let requested;
  const service = createVoiceService({
    authTokens: {
      async create(input) {
        requested = input;
        return { name: "auth_tokens/test-only" };
      },
    },
  });
  const session = { state: createShoppingSession() };
  const result = await service.issue(session);
  assert.equal(requested.config.uses, 1);
  assert.equal(requested.config.httpOptions.apiVersion, "v1alpha");
  assert.equal(
    requested.config.liveConnectConstraints.config.systemInstruction,
    TOYO_VOICE_INSTRUCTIONS,
  );
  assert.equal(
    requested.config.liveConnectConstraints.config.responseModalities[0],
    "AUDIO",
  );
  assert.equal(result.token, "auth_tokens/test-only");
  assert.equal(result.voiceSessionId, session.voiceLease.id);
  assert.ok(session.voiceLease.expires > Date.now());
  assert.equal(createVoiceService(null).configured, false);
});

test("spoken finance details are previewed and cannot commit until their exact readback draft is confirmed", () => {
  const session = sessionAtFinance();
  const original = structuredClone(session.state);
  const prepared = executeVoiceTool(session, "prepare_finance", finance);
  assert.deepEqual(session.state, original);
  assert.equal(prepared.draft.quote.rebate, 500);
  assert.throws(() =>
    executeVoiceTool(session, "confirm_details", {
      revision: 2,
      draftId: prepared.draft.id,
      userConfirmed: false,
    }),
  );
  assert.throws(() =>
    executeVoiceTool(session, "confirm_details", {
      revision: 2,
      draftId: "wrong",
      userConfirmed: true,
    }),
  );
  executeVoiceTool(session, "confirm_details", {
    revision: 2,
    draftId: prepared.draft.id,
    userConfirmed: true,
  });
  assert.equal(session.state.stage, "checkout");
  assert.equal(session.state.reviewed, false);
  assert.equal(session.state.quote.rebate, 500);
  assert.equal(session.voiceDraft, null);
});

test("correcting a readback invalidates the previous draft and stale revisions cannot prepare new drafts", () => {
  const session = sessionAtFinance();
  const first = executeVoiceTool(session, "prepare_finance", finance).draft;
  const second = executeVoiceTool(session, "prepare_finance", {
    ...finance,
    downPayment: 4000,
  }).draft;
  assert.notEqual(first.id, second.id);
  assert.throws(() =>
    executeVoiceTool(session, "confirm_details", {
      revision: 2,
      draftId: first.id,
      userConfirmed: true,
    }),
  );
  assert.throws(
    () =>
      executeVoiceTool(session, "prepare_finance", { ...finance, revision: 1 }),
    /Stale/,
  );
  assert.throws(() =>
    executeVoiceTool(session, "prepare_finance", { ...finance, apr: -1 }),
  );
});

test("insurance readback saves review but voice cannot select a car or confirm a purchase", () => {
  const session = sessionAtFinance();
  assert.throws(() => executeVoiceTool(session, "CONFIRM", { revision: 2 }));
  assert.throws(() =>
    executeVoiceTool(session, "choose_vehicle", { revision: 2 }),
  );
  const plan = executeVoiceTool(session, "prepare_finance", finance).draft;
  executeVoiceTool(session, "confirm_details", {
    revision: 2,
    draftId: plan.id,
    userConfirmed: true,
  });
  const draft = executeVoiceTool(session, "prepare_insurance", {
    revision: 3,
    mode: "additional",
    monthly: 100,
  }).draft;
  assert.equal(session.state.reviewed, false);
  executeVoiceTool(session, "confirm_details", {
    revision: 3,
    draftId: draft.id,
    userConfirmed: true,
  });
  assert.equal(session.state.reviewed, true);
  assert.equal(session.state.stage, "checkout");
  assert.equal(session.state.quote.assumptions.ownershipCosts, 250);
  assert.throws(() => executeVoiceTool(session, "CONFIRM", { revision: 4 }));
});

test("reservation dictation requires a completed car and exact readback, and never consents or submits", () => {
  const session = sessionAtFinance();
  assert.throws(() =>
    executeVoiceTool(session, "prepare_reservation", {
      revision: 2,
      name: "Example",
      phone: "+15551234567",
    }),
  );
  session.state = {
    ...session.state,
    stage: "complete",
    outcome: "simulated_purchase",
  };
  const draft = executeVoiceTool(session, "prepare_reservation", {
    revision: 2,
    name: "Nguyễn Example",
    phone: "+1 (555) 123-4567",
  }).draft;
  assert.equal(session.reservationContact, undefined);
  assert.equal(draft.event.contact.phone, "+15551234567");
  assert.throws(() =>
    executeVoiceTool(session, "confirm_details", {
      revision: 2,
      draftId: draft.id,
      userConfirmed: false,
    }),
  );
  const corrected = executeVoiceTool(session, "prepare_reservation", {
    revision: 2,
    name: "Nguyễn Example",
    phone: "+15557654321",
  }).draft;
  assert.throws(() =>
    executeVoiceTool(session, "confirm_details", {
      revision: 2,
      draftId: draft.id,
      userConfirmed: true,
    }),
  );
  const result = executeVoiceTool(session, "confirm_details", {
    revision: 2,
    draftId: corrected.id,
    userConfirmed: true,
  });
  assert.equal(result.reservationContact.phone, "+15557654321");
  assert.equal(result.reservationContact.consent, undefined);
  assert.equal(session.state.reservationReady, undefined);
  assert.equal(session.state.reservationId, undefined);
  assert.equal(JSON.stringify(session.state).includes("Nguyễn"), false);
  assert.throws(() =>
    executeVoiceTool(session, "submit_reservation", { revision: 3 }),
  );
  session.state.reservationReady = true;
  assert.throws(() =>
    executeVoiceTool(session, "prepare_reservation", {
      revision: 3,
      name: "Change",
      phone: "+15551234567",
    }),
  );
});

test("explicit voice backup navigates displayed HQ/car and confirms checkout only after review", () => {
  const session = { state: createShoppingSession(), updated: Date.now() };
  const navigate = (action, extra = {}) =>
    executeVoiceTool(session, "navigate_step", {
      revision: session.state.revision,
      action,
      vehicleId: session.state.vehicleId || "",
      userConfirmed: true,
      ...extra,
    });
  assert.throws(() => navigate("hq_yes", { userConfirmed: false }));
  navigate("hq_yes");
  navigate("hq_yes");
  assert.equal(session.state.stage, "dealer");
  assert.throws(() => navigate("choose_car", { vehicleId: "different-car" }));
  navigate("choose_car");
  assert.equal(session.state.stage, "finance");
  assert.throws(() => navigate("confirm_checkout"));
  session.state = shoppingTransition(session.state, {
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
  assert.throws(() => navigate("confirm_checkout"));
  session.state = shoppingTransition(session.state, {
    type: "INSURANCE",
    insurance: { mode: "included", monthly: 0, accepted: true },
  });
  session.voiceDraft = { id: "pending" };
  assert.throws(() => navigate("confirm_checkout"));
  session.voiceDraft = null;
  const oldRevision = session.state.revision;
  navigate("confirm_checkout");
  assert.equal(session.state.stage, "complete");
  assert.equal(session.state.confirmationSource, "voice");
  assert.throws(() => navigate("confirm_checkout", { revision: oldRevision }));
});
