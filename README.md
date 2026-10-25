# TOYO Pocket Agent

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

## Model selection

Set `GEMINI_API_KEY` in `.env` and restart to enable model selection. The server first filters by body style and price band. Gemini then selects only from those valid IDs; unknown IDs are rejected. Model recommendations occur after the completed questionnaire or an explicit rerank click. Without a key, or when Gemini fails, deterministic catalog matches remain available with the lowest MSRP first. AI text never sets prices, loan amounts, affordability, or confirmation state.

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
ARDUINO_PORT=
PORT=3001
```

The main TOYO panel supports browser narration. Existing LumiWorld and legacy Drive APIs retain their Gemini/ElevenLabs configuration; optional `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are server-only. Never commit `.env` or expose provider keys through `VITE_` variables.

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
npm run verify:browser-serial # temporary server; checks browser-reported input
npm run verify:firmware # host timing harness; requires a C++17 compiler
npm run verify:toyo   # temporary localhost server, fake serial and model; no paid calls
npm run verify:drive # preserved legacy API contract checks
npm run build
```

Sessions live in server memory and expire after two hours. Reloading starts a new session. This prototype binds to localhost. Public deployment requires a separate hosting and persistence design.
