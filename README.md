# TOYO Pocket Agent (A custom tech from Rizzk)

A Toyota shopping pitch with a pink 3D town, TOYO as your guide, a photo garage, financing assumptions, and a simulated checkout. Cinderella has been removed from the main experience. The original LumiWorld storybook remains at `/?lumi`.

## Run

Node 22.12+ is required.

```sh
npm install
# For a fresh checkout only: cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. `npm run build` produces `dist`; `npm start` serves it at **http://localhost:3001**.

## Shopping flow

1. **Agent Headquarters:** TOYO asks about Sedan, SUV, or Minivans and Trucks, then the $15,000–$25,000, $25,000–$40,000, or Over $40,000 band. Yes selects the displayed option; No cycles to the next option. $25,000 belongs to the middle band; $40,000 belongs to the middle band.
2. **Toyota Dealership:** browse matching models in the garage, inspect supplied photos and starting MSRP, then choose a car. You can also browse the entire catalog. Vehicles outside your preferences are labeled. Empty matches stay empty rather than inventing stock.
3. **Financial District:** enter available savings, protected emergency savings, total monthly car budget, monthly running costs, down payment, fixed APR, and loan term. Cash purchases are also supported. The server calculates fixed-rate amortization, including 0% APR, and adds $2,200 of illustrative fees.
4. **Payment + Insurance Office:** review the quote, indicate whether insurance is included in running costs or add a monthly estimate, and acknowledge the assumptions. The magic wand then confirms a simulated purchase when affordable, or finishes with a savings plan. No payment, credit application, vehicle order, or insurance policy is created.

Buildings and location buttons open the corresponding task when its prerequisites are satisfied. Home and Market Center are contextual town locations. Camera reset and mouse orbit/zoom remain available. The story panel works without WebGL.

## Catalog and photos

`data/vehicles.json` is the runtime source copied from the supplied Toyota seed database. `data/vehicles.csv` is the matching reference copy. These contain 10 model-level entries, starting MSRPs, and observation dates—not dealer offers, VINs, stock quantities, or live pricing. Replace or update both source files when refreshing your database, then restart the server. Prices exclude delivery, tax, title, registration, and dealer charges; the calculator's assumed fees are not an actual out-the-door quote.

SUV matching groups Crossover, SUV, and Electric SUV entries. “Minivans and Trucks” groups the supplied Truck (Tacoma) and Minivan (Sienna) categories. In the supplied catalog, Tacoma matches the $25,000–$40,000 band and Sienna matches Over $40,000. Hatchbacks remain available in the full garage rather than being mislabeled as sedans or SUVs.

User-supplied photos in `public/vehicles` map Corolla to `corolla.png`, Corolla Hybrid to `corolla-hybrid.png`, and Camry to `camry.png`. SUV photos map Corolla Cross to `corolla-cross.png`, Corolla Cross Hybrid to `corolla-crosshybrid.png`, RAV4 to `rav4.png`, and bZ to `bz.png`. Minivans and Trucks photos map Sienna to `sienna.avif` and Tacoma to `tacoma.webp`, matching the actual formats of the supplied files. Models without supplied photos use labeled photo placeholders. Photo model year and trim are not verified. Source files in Downloads are preserved.

## Rebate offers

The garage advertises two offers from `data/offers.json`: **$500 College Rebate** and **$500 Military Cash Rebate**. Select one in the financial district and acknowledge assumed eligibility. Neither is selected automatically. Both are simulation references to [Toyota College Rebate](https://www.toyota.com/college-rebate/) and [Toyota Military Rebate](https://www.toyota.com/military-rebate/), assuming qualifying Toyota Financial Services financing; actual eligibility, regional terms, and availability need dealer verification. No real rebate is redeemed.

The server accepts one listed offer ID, disallows stacking College and Military, and rejects pay-in-full application. It subtracts $500 from the illustrative purchase total before amortization. The quote separately displays the gross price, rebate, and net total. Insurance review and final confirmation recompute from the original catalog price so a rebate cannot be applied twice. Rebates do not alter the HQ MSRP price bands.

`data/toyota_world.sqlite` is a project-local copy of the supplied seed database with both offers populated in its `offers` table (`is_simulated = 1`). The original Downloads database is preserved. The app reads JSON at runtime; after editing `data/offers.json`, run `python3 scripts/sync-offers.py` to update the SQLite snapshot, then restart the app.

## Gemini Live seller voice

Click **Voice mode** to activate TOYO's two-way seller conversation. Voice is never started on page load. The browser asks for microphone permission and displays **Connecting to Gemini Live…**; **Live · Listening** appears only after Gemini acknowledges session setup. It then switches between Listening and Speaking. Mute disables the microphone tracks; Stop closes the connection and releases audio resources. The existing “Read TOYO’s guidance” button remains a separate browser-narration fallback and is disabled while Live voice runs.

Local configuration:

```dotenv
GEMINI_API_KEY=your_server_side_key
GEMINI_LIVE_MODEL=gemini-3.8-live
GEMINI_LIVE_VOICE=Kore
```

Restart `npm run dev`, open `http://localhost:5173` in a browser supporting microphone capture and AudioWorklet (for example desktop Chrome), then click Voice mode and allow the microphone. Use a Live model available to your Google AI project; the model and voice name are configurable. An API key merely being present does not prove model access. Token-creation errors and socket errors are shown; the app does not label a failed connection as Live. HTTPS is required outside localhost. Hosted Gemini keys and Live settings belong on Render, not in `VITE_` variables.

TOYO's full seller instruction is `TOYO_VOICE_INSTRUCTIONS` in `server/voice-agent.mjs`:

1. **Agent HQ:** discuss needs and budget, clarify the category and price band, save agreed preferences and recommend only existing matches.
2. **Garage stash:** explain and inspect catalog cars. One D2 press moves to the next; two presses or the Choose button select the displayed car. The agent cannot commit a vehicle selection itself.
3. **Financial district:** collect user-provided savings, reserve, down payment, ownership budget, APR, method and term. `prepare_finance` validates and previews a draft while keeping the user on the finance step. TOYO reads every detail back; a separate affirmative response or **Confirm these details** commits that exact draft. Corrections replace the draft and require readback again. These are assumed rebate eligibility and illustrative finance inputs, not real credit underwriting.
4. **Payment + insurance:** explain the calculator's actual totals and affordability reasons, then prepare/read back the insurance assumption. A confirmed insurance draft marks review complete. Pending readbacks block final checkout. The user alone presses the Arduino magic wand or browser confirmation button to finish a simulated purchase or savings plan.

Voice tool calls are validated by the backend with the current journey revision, a short-lived voice lease, allowed function names and schemas, and draft IDs. No purchase-confirmation or vehicle-selection-commit tool is exposed to Gemini. Spoken confirmation of draft details is interpreted by the model; the final simulated purchase remains explicitly button-gated. Mouse and D2 state changes update the Live context so TOYO continues from the correct stage. Stopping or renewing Voice mode revokes the old tool lease and clears pending readbacks.

The backend mints a single-use ephemeral token constrained to the model, seller instruction, voice and tool declarations. Microphone audio travels from the browser directly to Gemini Live; it does not go through the Vercel gateway. Input is mono 16 kHz PCM from an AudioWorklet; output PCM is queued through Web Audio, with interruption handling. A transcript is kept in the tab's memory, with no raw audio recording stored by the app. Voice sessions stop after eight minutes; reconnecting picks up the existing backend shopping state. Reloading the whole page still starts a new shopping session.

The **computer microphone** supplies voice; Grove A0 remains a raw sound-level diagnostic. D2 and the active D5 buzzer retain their existing behavior. Tests use synthetic microphone audio and mocked Gemini tokens/socket messages; actual account access, speech recognition quality and a real Gemini audio round trip still require a live test. References: [Google Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities), [ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens), and [tool use](https://ai.google.dev/gemini-api/docs/live-api/tools).

## Current prices and offers with SerpAPI

The garage includes **Search current prices** and **Search current offers**, with an optional five-digit US ZIP code. Add `SERPAPI_API_KEY` to the Node backend's environment (`.env` locally, Render environment variables when hosted) and restart/redeploy that backend. Obtain a key through [SerpAPI](https://serpapi.com/manage-api-key). Never use a `VITE_` key or put it in browser code. The feature reports whether search is connected without returning the key.

`POST /api/toyo/market-search` accepts the current session revision, selected vehicle ID, `kind` (`prices` or `offers`), and optional `zip`. The server constructs the Google query from the catalog vehicle, calls [SerpAPI's Google Search endpoint](https://serpapi.com/search-api), and returns up to six organic results with title, HTTPS source link, snippet, optional source date, and retrieval time. The ZIP is included in the search query; it is not a guaranteed inventory radius filter. Search requests occur only on explicit form submission, not on page load or Arduino input.

Matching queries are cached for ten minutes in the backend process, concurrent identical queries share a provider request, and the cache is bounded to 100 entries. SerpAPI and Google may also cache or index older content. Retrieval time does not establish that a price or promotion is still valid. Provider errors never expose raw credential-bearing URLs or response bodies to the browser.

Search results are research links, not a live inventory feed, verified dealer quotes, or automatically approved rebates. They do not change the catalog, HQ price band, recommendation, quote, or selected rebate. Prices and terms must be checked on the source page before being adopted as actual offer data. Changed vehicle selections cancel the client search and reject stale server responses.

This integration uses the existing backend deployment and Vercel gateway; SerpAPI is a data source, not a replacement for the Node service. Tests use mocked results and do not spend search credits. Run `npm run verify:market-search` for the HTTP contract checks.

## Model selection

Set `GEMINI_API_KEY` in `.env` and restart to enable model selection. The server first filters by body style and price band. Gemini then selects only from those valid IDs; unknown IDs are rejected. Model recommendations occur after the completed questionnaire or an explicit rerank click. Without a key, or when Gemini fails, deterministic catalog matches remain available with the lowest MSRP first. AI text never sets prices, loan amounts, affordability, or confirmation state.

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
ARDUINO_PORT=
PORT=3001
```

The main TOYO panel supports opt-in Gemini Live voice and separate browser narration. Existing LumiWorld and legacy Drive APIs retain their Gemini/ElevenLabs configuration; optional `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are server-only. Never commit `.env` or expose provider keys through `VITE_` variables.

## Deploy this app: Vercel frontend + Render backend

The repo includes `render.yaml` for a single Node service and `vercel.json` plus `api/proxy.mjs` for a same-origin API gateway. The gateway is stateless; shopping sessions and browser-serial nonce consumption stay in the running Render process. This avoids relying on serverless function memory for session continuity.

1. Push the tested deployment files to the GitHub repository.
2. In Render, create a Blueprint from `https://github.com/HungH206/strytelker` using `render.yaml`. It specifies a **free** Node 24 service, a build with development dependencies, `npm start`, `HOST=0.0.0.0`, and the `/api/health` check. Render supplies `PORT`; leave `ARDUINO_PORT` empty.
3. Copy the actual HTTPS origin assigned to the service. Verify `https://<actual-render-host>/api/health` returns JSON with `status: "ok"`. Do not assume a particular hostname from the service name.
4. In the existing Vercel project's environment variables, set **`TOYO_BACKEND_URL`** to that Render origin, such as `https://your-actual-service.onrender.com`, with no `/api` suffix or path. Set it for the deployment environments you use.
5. Redeploy Vercel. Its configuration uses the Vite frontend and forwards `/api/*` through the Node function to Render. Session tokens and request bodies are preserved; personalized API responses are never cached. Frontend requests remain same-origin, so a separate CORS configuration is unnecessary for this setup.
6. Verify both `https://strytelker.vercel.app/api/health` and `/api/toyo/config` return JSON, then test HQ → garage → finance → insurance → confirmation.
7. Add `GEMINI_API_KEY` on **Render** only if you want model ranking, and `SERPAPI_API_KEY` if you want web price/offer searches, then redeploy that service. Optional ElevenLabs keys also belong on Render. The app works with rule-based matching and browser narration without these keys. No provider secret is needed in the Vercel frontend.

Until `TOYO_BACKEND_URL` is configured, the Vercel gateway returns a JSON **503** with setup instructions instead of a text 404. If Render is unreachable or still waking, it returns an actionable JSON 502/504. The free Render plan can sleep when idle, and any backend restart resets these in-memory sessions; reload to start a new journey. Keep the service at one instance. Durable sessions or multiple replicas require a shared session store before scaling.

`npm run verify:deployment` starts a real local backend with cloud-style binding and runs the gateway through a complete simulated purchase, including rebate, insurance, browser-serial confirmation, and replay rejection. It does not contact paid providers or real hardware. Configuration references: [Render Blueprints](https://render.com/docs/blueprint-spec), [Render port binding](https://render.com/docs/web-services), and [Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js).

## Hosted website: connect Arduino in the browser

The hardware panel has two transports. **Browser USB · hosted website** is selected by default on hosted domains; localhost defaults to **Local server bridge**. Both use the existing `sketch/sketch.ino` and the same D2 single/double-press mappings.

For a `.tech` domain:

1. Serve the app over **HTTPS** and route `/api/toyo/*` to the Node backend. GitHub Pages alone cannot run the API, calculator sessions, or Gemini adapter.
2. Open the site in a desktop browser with Web Serial support, such as Chrome. Feature detection shows a helpful message when unavailable. If your host sets Permissions-Policy, allow `serial=(self)`.
3. Plug the Arduino into the computer running that browser. Close Arduino Serial Monitor and any other process holding the port.
4. Choose **Browser USB · hosted website**, click **Connect Arduino**, and choose the Arduino in the browser's permission picker. D2 controls enable after connection.
5. Keep the tab open. Use **Disconnect Arduino** before opening Serial Monitor. Reconnect after unplugging.

Browser USB does not require `ARDUINO_PORT` or a local Node bridge. For local testing in Browser USB mode, clear `ARDUINO_PORT` and restart the backend so it does not hold the same USB port. The hosted backend's `ARDUINO_PORT` should stay unset for this mode. Provider keys stay on that backend.

The browser serial adapter sends the server-issued `ARM` nonce to the board and reports only matching `PRESS` lines. The server binds each nonce to a session revision for 30 seconds, consumes it once, enforces the HQ/garage/checkout gates, and recomputes the purchase quote. Changed steps, model requests, transport switches, and explicit disarms invalidate outstanding arms. Disconnect releases the stream locks; oversized lines and sound telemetry never become button actions.

Browser-reported confirmation uses `confirmationSource: browser_serial`, separate from trusted server-owned serial input (`hardware`). Fresh nonces prevent replay and cross-session use, but cannot prove a browser-reported event came from a physical device. This adapter remains for the simulated checkout. Browser tests use a mocked serial device; an actual USB round trip is still to be verified.

Implementation: `src/browser-serial.mjs` owns the port and stream lifecycle; `src/useArduinoControls.ts` coordinates transports and step arming; `server/arduino-actions.mjs` maps gestures consistently. API checks: `npm run verify:browser-serial`.

## Grove Base Shield and Arduino

| Module | Connector | Behavior |
| --- | --- | --- |
| Sound sensor | A0 | Raw ADC diagnostics every 250 ms; no audio recognition or clap actions |
| Grove button | D2 | Active-high, debounced single/double-press navigation |
| Active buzzer | D5 | Brief ready beep; longer gesture-sent beep |

Upload `sketch/sketch.ino` through Arduino IDE. The sketch is already in its matching Arduino IDE folder. For UNO Q, use a current Zephyr core (0.55.0+) where `Serial` aliases `Monitor`, and set the compatible Grove Base Shield voltage selector to **3.3 V**. See [Arduino's core migration guide](https://support.arduino.cc/hc/en-us/articles/27251870677916-Migrating-to-Zephyr-core-0-55-0-on-UNO-Q) and [UNO Q power specifications](https://docs.arduino.cc/tutorials/uno-q/power-specification).

1. Run `npm run arduino:ports` to find the port path.
2. Set `ARDUINO_PORT=/dev/cu.usbmodem...` in `.env` (Windows: `COM3`; Linux: `/dev/ttyACM0`). This is the port path, not the board serial number.
3. Close Serial Monitor and restart `npm run dev`.
4. Turn on **Enable D2 controls** in the panel. At HQ, single press = Yes and double press = No. In the garage, single press = Next car and double press = Choose car. Double presses must be quick, within the 400 ms gesture window.
5. Type financial values normally. After reviewing payment and insurance, a single press becomes the magic wand confirmation.

The server automatically rearms after each accepted action and renews the 30-second arm window while controls are enabled. Release the button after arming before beginning a gesture. Navigation waits for the double-press window before dispatching a single press. Each command uses a fresh nonce bound to a session revision; consumed, expired, stale, or foreign-session events cannot advance that revision. In Local server bridge mode, only one session owns the shared button at a time. Each Browser USB session instead uses the device explicitly selected on that computer. Hardware input is paused during numeric entry and model requests. Restart the server after unplugging/reconnecting the board.

Serial protocol at 9600 baud: `ARM <nonce> NAV` enables gesture counting, returning `PRESS <nonce> 1` or `PRESS <nonce> 2`. `ARM <nonce>` enables single-press confirmation, returning `PRESS <nonce>`. `DISARM` clears the pending gesture. `SOUND <raw>` is diagnostic only. Buzzer feedback means the firmware sent a gesture, not that the server accepted it. Hardware needs the updated sketch for double-press support. A host-side C++ timing harness covers single/double presses, debounce, held buttons, disarm, and expiry. Board/core compilation and physical wiring have not been verified in this workspace.

## Code and checks

- `src/App.tsx`: town layout and current task.
- `src/ShoppingPanel.tsx`: HQ questionnaire, garage, finance, checkout, and D2 control lifecycle.
- `src/WorldScene.tsx`: lazy-loaded 3D town and TOYO robot.
- `src/index.css`: pink design and responsive panel styles.
- `server/toyo-engine.mjs`: catalog mapping, matching, and shopping state machine.
- `server/toyo-api.mjs`: sessions, model adapter, and hardware dispatch.
- `server/arduino.mjs`: shared server-owned serial connection.
- `server/drive-engine.mjs`: shared amortization calculator and preserved legacy Drive flow.

```sh
npm test
npm run verify:voice # mock Gemini token and voice-tool contract; no paid calls
npm run verify:market-search # mock SerpAPI contract; no paid searches
npm run verify:deployment # real local backend behind the hosting gateway
npm run verify:browser-serial # temporary server; checks browser-reported input
npm run verify:firmware # host timing harness; requires a C++17 compiler
npm run verify:toyo   # temporary localhost server, fake serial and model; no paid calls
npm run verify:drive # preserved legacy API contract checks
npm run build
```

Sessions live in server memory and expire after two hours. Reloading starts a new session. Local development binds to localhost. Render uses `HOST=0.0.0.0` from its Blueprint. Hosted sessions remain process-local as described in the deployment section.

### Customer reservations and downloads

After an affordable plan is confirmed with the magic wand, the completion screen asks for the customer's name, phone number (including country code), and permission to save. The buyer can type contact details or opt into reservation dictation through Voice mode. Dictated contact details are processed by Gemini and read back before filling the form; manually typed contact details are not added to Gemini context. Saving creates a **demo reservation**, not a dealer booking or SMS confirmation.

The backend stores reservations in a separate SQLite database at `.local/reservations.sqlite` (ignored by Git), configurable through `RESERVATIONS_DB_PATH`. Each record contains contact details and a server-generated snapshot of the selected car, finance assumptions, calculated quote, selected rebate and insurance assumptions. Retries for the same journey return the existing record. JSON and CSV downloads require the current private journey token; download before refreshing or starting a new journey. Saved database records survive a local server restart, but browser sessions and download access do not. No public reservation listing is exposed.

Use Node 24 for the native SQLite module. Keep the database private and backed up. For hosting, point `RESERVATIONS_DB_PATH` at a persistent disk; the current free Render configuration has ephemeral storage and will lose records when the instance is replaced. Do not rely on it for real customer reservations without persistent storage. The CSV export escapes spreadsheet formula prefixes. Phone formatting is validated; ownership is not verified.

### Tiger Data and the separate staff reservation monitor

Open `http://localhost:5173/?monitor` while `npm run dev` is running. This staff view is separate from the customer journey and includes search, status filters, car/contact details, finance and insurance summaries, JSON/CSV downloads, and a status-change history. It shows the latest 200 reservations; use Refresh to retrieve new entries. Access uses a shared staff key kept only in the tab's memory. This is a small-team monitor, without individual staff accounts or per-person audit attribution.

1. Create a PostgreSQL service in Tiger Console and copy its PostgreSQL connection URL into the backend `.env` as `TIGER_DATABASE_URL`. Keep this credential on the backend only, never in a `VITE_` variable or Git. Tiger Data connection guidance: https://www.tigerdata.com/docs/integrate/find-connection-details
2. Generate a staff key with `openssl rand -hex 32` and set `RESERVATION_ADMIN_TOKEN` in `.env`. The monitor is disabled until a key of at least 32 characters is configured. Enter this key on the monitor sign-in screen. Restart the backend after changing environment variables.
3. Run `npm run dev`. On the first reservation or authenticated monitor request, the backend creates the tables in [server/sql/reservations.sql](server/sql/reservations.sql). The database user needs permission to create these tables in its target schema. Connections use verified TLS; if your service requires its own CA bundle, set `TIGER_CA_CERT` to the PEM certificate (literal `\n` line separators are supported). Certificate verification is never disabled.
4. Make a demo reservation through the customer journey, then refresh the monitor. When connected, its storage label reads **Tiger Data**. Without `TIGER_DATABASE_URL`, the same monitor works against local SQLite. A configured but unreachable Tiger service returns an error; it does not silently store customer data elsewhere.

Tiger storage uses ordinary PostgreSQL tables: `toyo_customers` → `toyo_reservations` → `toyo_reservation_plans` and `toyo_reservation_events`. Customer, reservation, plan, and initial status writes are atomic. Duplicate saves for the same journey produce one reservation, including concurrent retries. The original receipt remains an immutable demo snapshot; staff follow-up status is tracked separately. “Confirmed” does not create a real dealer booking. Existing local SQLite reservations remain local and are not uploaded automatically.

For the hosted app, configure `TIGER_DATABASE_URL`, optional `TIGER_CA_CERT`, and `RESERVATION_ADMIN_TOKEN` on the **Node backend service**. Vercel continues using `TOYO_BACKEND_URL` for the gateway; it does not need the database URL or staff key. Open `https://your-site/?monitor` over HTTPS. Tiger Console's Data view can also query these tables directly to build internal reports.

Verification: `npm test`, `npm run build`, and `npm run verify:reservations`. The integration check requires `TEST_PG_SOCKET` pointing to a disposable local PostgreSQL Unix socket (optional `TEST_PG_PORT`, default 55439); it writes synthetic test records. Never point it at the customer database.


### Voice-assisted reservation and Arduino submission

After confirming an affordable car plan, keep or activate **Voice mode** to dictate a name and complete phone number, including country code. TOYO asks permission to collect these by voice, clarifies spelling/digits, prepares a contact readback, and asks for confirmation. Confirming that readback fills the form; it never gives storage consent or saves a reservation. Spoken contact details are sent to Gemini and appear in the tab's conversation transcript. Typing remains available.

Check the name, every phone digit, the selected car and plan, then check both the storage-consent and accuracy boxes. Click **Review reservation for submission**. This freezes an exact server-validated snapshot. Say **“save my reservation”** in Voice mode to let TOYO persist it through `save_reservation`, or press D2 once when D2 controls are enabled and connected. **Save demo reservation** is the browser equivalent. Voice readback confirmation alone does not authorize saving: TOYO asks a separate save question after review. Voice stays active to report the saved reference; use Stop voice mode to release the microphone. **Revise contact details** invalidates any armed press before allowing edits. Double presses, stale challenges, and pending voice readbacks cannot submit. The saved reference and JSON/CSV downloads appear after persistence succeeds. Both browser USB and local bridge transports are supported; the hosted site uses browser USB.

Run `npm run verify:reservation-controls` for the synthetic server integration check covering voice readback, manual consent/review gates, both Arduino transports, duplicate/stale/double press rejection, explicit voice submission, and saved exports. Real Google speech recognition and physical Arduino testing require the connected equipment and account.


### Voice backup when D2 is unavailable

Activate Voice mode and respond to TOYO's current question. Say **confirm** for the displayed HQ option or car selection, **no** for the next HQ option, or **next car** to browse. TOYO uses `navigate_step` with the current screen revision and exact displayed car ID. At checkout, TOYO first reads back the car and reviewed finance/insurance plan and asks a separate final confirmation question; only then does a spoken confirmation complete the demo checkout. Pending readbacks, wrong car IDs, unfinished insurance review, and stale revisions are rejected. Reservation saving still requires the on-screen consent/accuracy review and a separate save instruction. D2 and browser buttons remain available.

### Model-specific OTD estimates

`data/otd-estimates.json` contains the nine supplied 2026 model estimates. Garage cards, TOYO voice context, finance calculations and new reservation snapshots use the exact taxes-and-fees amount for each mapped vehicle. Estimated OTD is MSRP plus those fees, before any selected rebate or loan interest. These are user-supplied illustrative values with no tax jurisdiction supplied, not verified dealer quotes. The non-hybrid Corolla was omitted from the supplied list and retains a clearly labeled $2,200 fallback fee assumption. Budget bands still filter MSRP.

The backend seeds `toyota_otd_estimates` in Tiger PostgreSQL during its first reservation-store initialization (for example, when opening the authenticated monitor); local SQLite receives the same nine rows. `server/sql/otd-estimates.sql` can also be run directly in Tiger Console. It updates matching model names and inserts missing ones, so rerunning does not add duplicates; it also works with the originally supplied table structure. Existing duplicate rows, if any, are retained. Existing saved reservations keep their original quote snapshots.

The JSON file is the application's versioned source for these assumptions; the database table mirrors it for reporting. Editing only the database table does not change the runtime calculator. Update the JSON and matching SQL seed together, then redeploy Render and Vercel to publish changes.
