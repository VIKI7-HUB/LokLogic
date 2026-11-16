# Harvest Saathi: product and agent design

## Challenge analysis

Tech4Bharat problem 6.1 is explicitly tagged **Agentic AI**. It describes small and marginal farmers deciding under sparse local price data, perishability, limited storage, urgent cash needs and possible debt to a trader. The brief preserves the farmer's authority and requires uncertainty to be visible. The broader challenge asks for voice-first vernacular use on entry-level Android devices, tolerance for interrupted connectivity, limited data collection, an assisted JanAI Café path when physical help is needed, and clearly disclosed mock integrations.

The jury evaluates both technical quality (architecture, AI, working prototype, innovation) and entrepreneurial strength (problem fit, market, business model, scalability and jobs). That makes the product's differentiator a transparent decision workflow and partner-assisted operations, not an unqualified price prediction.

## User goal

“Help me compare realistic ways to sell this harvest, meet my cash deadline, and prepare the next questions I need answered.”

## Agent workflow

1. **Collect a case:** crop, quantity, area, cash deadline, two mandi prices, transport, commission, storage cost, possible later-price range and spoilage assumption.
2. **Load evidence:** use entered values, an AGMARKNET CSV, or the data.gov.in API when configured. Preserve market and date. Reject malformed/unmatched rows and keep manual input available if a source fails.
3. **Calculate outcomes:** Node server tools deterministically compute net proceeds after entered fees, travel, storage and produce loss. The language model cannot change or invent prices.
4. **Apply constraints:** storage remains visible but is excluded from the headline when the farmer needs cash before the storage period ends.
5. **Explain and plan:** Gemini uses declared tools to compare, check the deadline and draft questions. If no API key is configured or the model is unavailable, a rules agent returns a transparent fallback.
6. **Request approval:** show the exact draft and require a user checkbox before preparing it. Current integration is a local simulation; no message or sale is sent.
7. **Remember by choice:** the user may save case inputs in local browser storage. No account or cloud upload is used.

## Architecture

- `index.html`, `styles.css`, `app.js`: responsive PWA interface, form calculation display, browser voice input, CSV import, local case save/resume and consent dialogs.
- `server.mjs`: zero-dependency Node HTTP server; serves static files, proxies optional data.gov.in price requests, validates a case, runs the deterministic rules agent, and uses Gemini function calling when configured.
- `.env`: local-only API keys; never committed. `.env.example` documents variable names without secrets.
- `service-worker.js`: caches the static shell for offline use after the first HTTP(S) visit. Live prices and model calls still require connectivity.

## Tool boundaries

The model may request only `compare_selling_options`, `check_cash_deadline` and `draft_buyer_questions`. These tools use the server's case values and have no external side effects. Price arithmetic and feasibility rules stay deterministic. Future tools such as `find_storage_options` or `request_transport_quote` should be added only with reliable partner data, action previews and approval before any contact or financial commitment.

## Assumptions to validate

- Farmers need net proceeds after the actual costs, not only headline mandi prices.
- A farmer or assisted FPO/JanAI Café can verify transport, fees and storage costs.
- Public market rows match the farmer's crop, variety, grade, market and sale date.
- A short spoken explanation and buyer question are useful next steps.

The project has not been validated with local farmers. Remote conversations with an FPO, KVK, agricultural college or farmer-facing organisation are the proposed substitute for the team's lack of local access; their feedback must be labelled as expert feedback, not farmer validation.
