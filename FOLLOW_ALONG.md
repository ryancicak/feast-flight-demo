# Follow along

Companion to the video on **Omnigent** (Databricks' open-source meta-harness) and this flight-ops agent. It is split into two parts so you can do as much as your setup allows:

- **Part 1 - the Omnigent cross-vendor demo (anyone, about 5 minutes).** Install Omnigent, run Claude Code, then have it referee two rival vendors: Claude writes, Codex reviews, in one session. No Databricks needed.
- **Part 2 - the under-10ms Lakebase agent (bring your own Databricks).** Stand up the feature store + agent on your own workspace and watch it read Lakebase live. The single-digit-millisecond number is an *in-region* read, so you need your own Databricks workspace to reproduce it - this repo gives you everything to do that.

---

## Part 1 - Omnigent cross-vendor in ~5 minutes (anyone)

1. **Install Omnigent** (open source) and configure your model credentials:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/omnigent-ai/omnigent/main/scripts/install_oss.sh | sh
   # or, if you prefer: uv tool install omnigent   (needs Python 3.12+, uv, git, Node 22 LTS+)
   omnigent setup   # configure your model credentials
   ```
   Full install notes: https://github.com/omnigent-ai/omnigent

2. **Start it** and open the local URL it prints (something like `http://localhost:6767`):
   ```bash
   omnigent run
   ```

3. **Configure your harnesses** (in `omnigent setup` or the first-run picker):
   - **Claude** - your Claude subscription / login.
   - **Codex** - a ChatGPT login (paid plan), an OpenAI API key, or, if you are on Databricks, the Databricks AI Gateway.
   - **Pi** - skip it.

4. **Open a Polly session and run the cross-vendor check** (the "one vendor writes, a different vendor reviews" moment). In the Omnigent UI, start a new session, pick **Polly** from the agent list, then paste the prompt below (also in `video/polly-prompt.txt`):
   ```
   Spawn a Claude sub-agent to write a 3-sentence ops briefing on why Chicago
   O'Hare (ORD) flights are prone to winter delays. Then spawn a Codex sub-agent
   to review that briefing for accuracy and tighten the wording. Show me both the
   draft and the review.
   ```
   You will watch two different AI vendors work in one session - Claude drafts, Codex reviews.

---

## Part 2 - the under-10ms Lakebase agent (bring your own Databricks)

**Prereqs:** a Databricks workspace with Lakebase, and the Databricks CLI authenticated to a profile (`databricks auth login -p <your-profile>`). The full feature-store build and app setup live in the main [README.md](README.md).

1. **Clone and set up:**
   ```bash
   git clone https://github.com/ryancicak/feast-flight-demo.git
   cd feast-flight-demo
   # follow README.md to build the features and the Lakebase online store
   ```

2. **Run the agent locally** against your online store (uses the `.venv` and online store you built in step 1's README setup). From a laptop you also pay the WAN round trip, so expect tens of milliseconds here - around 70-80 ms (the single-digit number is in-region, step 3):
   ```bash
   source .venv/bin/activate          # the venv built per README.md
   export LAKEBASE_PROFILE=<your-databricks-profile>
   python flight_agent/agent_local.py "Score AA from ORD to LAX in 2007 and explain the risk."
   ```
   Every number the agent reports is grounded in real feature values (origin/carrier/route delay rates, the airport's weather climate, blended risk) - nothing invented - and it prints the measured Lakebase online-read latency.

3. **Deploy as a Databricks App** (in-region = single-digit milliseconds). The app serves `POST /api/agent`; see [README.md](README.md) for `databricks apps deploy`. Then point the helper scripts at your deployment:
   ```bash
   export APP_URL="https://<your-app>.aws.databricksapps.com"
   export DATABRICKS_PROFILE="<your-profile>"

   bash video/warmup.sh    # warms Lakebase so the first read is hot
   bash video/score.sh     # scores AA ORD->LAX 2007; watch reads[].latency_ms
   ```
   In-region, `reads[].latency_ms` is single-digit milliseconds because the app is co-located with Lakebase.

---

## How it maps to the video

| Video chapter | What you run here |
|---|---|
| What a meta-harness is | Part 1, steps 1-3 |
| Claude Code, live in the browser | Part 1, step 2 (start a Claude Code session) |
| Under-10ms Lakebase read | Part 2, steps 2-3 |
| Claude writes, Codex reviews | Part 1, step 4 (Polly) |
| Share a live session | copy your Omnigent session URL into a second browser window |

---

## Links

- Omnigent (open source): https://github.com/omnigent-ai/omnigent
- This repo: https://github.com/ryancicak/feast-flight-demo
