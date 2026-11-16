# LokLogic · Harvest Saathi

Harvest Saathi is a hackathon project for Tech4Bharat problem 6.1, **“Farmers sell at the wrong time, place and price.”** Its decision assistant compares selling routes using net proceeds, cash deadlines, storage costs and user-stated uncertainty.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` if you want optional live integrations.
3. Add your own `GEMINI_API_KEY` and/or `DATA_GOV_API_KEY` to `.env`. Keep `.env` private; it is ignored by Git.
4. Run `npm start` and open `http://127.0.0.1:4173`.

The app works without keys using the transparent rules agent, manual values and CSV import. A data.gov.in API key enables the official price-fetch button. A Gemini API key enables the model-backed tool-calling agent. The API keys stay on the local server and are never sent to the browser.

## What the project does

- Compares estimated take-home proceeds for a local mandi, another mandi, and a storage scenario.
- Applies entered commission, transport, storage, spoilage and cash-deadline constraints in deterministic code.
- Lets you import an AGMARKNET/data.gov.in CSV or fetch official daily rows when configured. It displays the market/date and labels daily wholesale prices as reference data, not firm offers.
- Uses a model tool loop when Gemini is configured; safe local rules run if the key is absent or the model service fails.
- Accepts speech input through browser speech recognition where available, with English (India), Hindi and Kannada language hints. Text input is the reliable fallback; speech behavior/connectivity depends on the browser.
- Saves and resumes a case locally only after the user chooses to save it.
- Requires a user approval checkbox before preparing a simulated quote-request draft. The demo does not send messages or make sales.
- Caches the static app shell for later offline access after first load over HTTP(S).

## Limits and safety

Prefilled prices and costs are illustrative. The future-price range and spoilage figure are user-entered scenarios, not model forecasts. Imported rows are not independently verified. Market prices may be sparse or stale, and a modal wholesale price is not a guaranteed farm-gate offer. Confirm variety, market, date, fees, transport, storage and payment conditions before making a real decision.

The current quote-request connector is intentionally simulated. The app asks for explicit approval before creating a local draft and never contacts a buyer, books a truck, pledges produce or places a sale. Do not enter personal identifiers. Browser speech recognition can be handled by browser-provided services; use text entry if that is unsuitable.

## Challenge fit and next work

The official brief marks 6.1 as Agentic AI and expects voice-first vernacular use, patchy-connectivity resilience, case memory, recoverable failures, stated uncertainty, human approval and disclosed mock integrations. This build has a local tool loop, manual/CSV/API price paths, opt-in local case memory, and a simulated approval flow. The remaining competition work is local-language response quality, field feedback through a remote FPO/KVK/agriculture college, verified local transport/storage offers, better stale-data handling and real partner integrations.
