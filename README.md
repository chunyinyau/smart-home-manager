# Wattch

Wattch is a smart home energy management demo built with Next.js. It shows how a Telegram-style orchestration flow, appliance controls, budget tracking, and forecasting can work together in one dashboard.

## What It Does

- Tracks budget, projected spend, and risk level.
- Displays appliance state and simulated shutdown actions.
- Surfaces alerts with acknowledgement and auto-cutoff behavior.
- Exposes API routes for budget, appliance, history, profile, rate, and forecast data.
- Includes a Telegram orchestrator flow for handling user intents.
- Runs rate, appliance, budget, bill, and history as Dockerized Python microservices.
- Runs calculatebill as a composite Flask microservice on port 5008.
- Runs forecastbill as a composite Flask microservice on port 5009.
- Uses RabbitMQ for asynchronous history log ingestion.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Lucide icons
- Flask microservices
- MySQL
- RabbitMQ

## Project Structure

- `app/page.tsx` - main dashboard UI
- `app/layout.tsx` - app shell and metadata
- `app/api/*` - route handlers for budget, forecast, appliance, history, profile, rate, and orchestrator flows
- `components/SpatialEnergyPanel.tsx` - spatial appliance visualization
- `lib/services/*` - business logic and repository helpers
- `lib/orchestrator/*` - Telegram intent parsing and orchestration
- `lib/clients/*` - lightweight client stubs used by the demo
- `history-service/` - Python Flask history microservice with RabbitMQ consumer

## Getting Started

1. Install dependencies:

```bash
npm install
```

1. Run the development server:

```bash
npm run dev
```

1. Start the backend microservices:

```bash
docker compose up --build -d
```

1. Open the app:

```text
http://localhost:3000
```

## Scripts

- `npm run dev` - start the local development server
- `npm run build` - build the production app
- `npm run start` - run the production build
- `npm run lint` - run ESLint
- `npm run smoke:test` - run API smoke checks for Next routes and all microservices

## Smoke Test

After the Next.js app and Docker microservices are running, execute:

```bash
npm run smoke:test
```

Optional environment variables:

- `SMOKE_BASE_URL` (default: `http://localhost:3000`)
- `SMOKE_TIMEOUT_MS` (default: `15000`)
- `SMOKE_BUDGET_USER_ID` (default: `1`)
- `SMOKE_HISTORY_USER_ID` (default: `user_demo_001`)
- `SMOKE_RATE_SERVICE_URL` (default: `http://localhost:5007`)
- `SMOKE_APPLIANCE_SERVICE_URL` (default: `http://localhost:5002`)
- `SMOKE_BILL_SERVICE_URL` (default: `http://localhost:5003`)
- `SMOKE_BUDGET_SERVICE_URL` (default: `http://localhost:5004`)
- `SMOKE_HISTORY_SERVICE_URL` (default: `http://localhost:5005`)
- `SMOKE_FORECASTBILL_SERVICE_URL` (default: `http://localhost:5009`)
- `SMOKE_CALCULATEBILL_SERVICE_URL` (default: `http://localhost:5008`)
- `SMOKE_PUBLIC_GATEWAY_BASE_URL` (optional: enables checks against Kong/ngrok public routes)

The smoke test now verifies all existing microservices (rate, appliance, bill, budget, history, forecastbill, and calculatebill) through direct service checks, in addition to key Next.js API proxy routes.
The app-level rate sync check treats `429` and `502` as tolerated warnings because the data.gov.sg upstream can be rate-limited or temporarily unavailable.
When `SMOKE_PUBLIC_GATEWAY_BASE_URL` is set, the smoke test also checks these public routes:

- `PUT /updatebudget/api/updatebudget/1`
- `POST /request-change/api/request-change`
- `POST /change-appliance-state/api/change-appliance-state`

## API Routes

The app includes the following route handlers:

- `GET /api/budget`
- `POST /api/budget/cap`
- `GET /api/appliance`
- `POST /api/appliance/[aid]/shutdown`
- `PATCH /api/appliance/[aid]/priority`
- `GET /api/appliance/telemetry/status`
- `GET /api/appliance/telemetry/current`
- `POST /api/appliance/telemetry/advance`
- `POST /api/appliance/telemetry/reset`
- `GET /api/history`
- `POST /api/history/log`
- `GET /api/profile`
- `GET /api/rate`
- `GET /api/forecast`
- `POST /api/orchestrator`

## OpenClaw + Telegram via ngrok

If you want OpenClaw Telegram to call the public Kong routes instead of the private Docker service names, configure the exact public endpoint URLs in `.env`:

```bash
OPENCLAW_UPDATE_BUDGET_URL="https://<your-ngrok-domain>.ngrok-free.app/updatebudget/api/updatebudget/{userId}"
OPENCLAW_REQUEST_CHANGE_URL="https://<your-ngrok-domain>.ngrok-free.app/request-change/api/request-change"
# Optional fallback if you want the older public route as well:
OPENCLAW_CHANGE_APPLIANCE_STATE_URL="https://<your-ngrok-domain>.ngrok-free.app/change-appliance-state/api/change-appliance-state"
```

Behavior:

- `set_budget` in the Telegram orchestrator uses `OPENCLAW_UPDATE_BUDGET_URL` when set.
- If the URL contains `{userId}`, the app issues `PUT` to the resolved path such as `/updatebudget/api/updatebudget/1`.
- If the URL does not contain `{userId}`, the app falls back to `POST` and includes `user_id` in the JSON body.
- `shutdown` uses `OPENCLAW_REQUEST_CHANGE_URL` first, then `OPENCLAW_CHANGE_APPLIANCE_STATE_URL`, and finally the internal Docker service.

For OpenClaw webhook mode, point Telegram at your ngrok URL and keep the webhook path aligned with OpenClaw's Telegram config. A minimal example looks like:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "123:abc",
      dmPolicy: "allowlist",
      allowFrom: ["123456789"],
      webhookUrl: "https://<your-ngrok-domain>.ngrok-free.app/telegram-webhook",
      webhookSecret: "replace-with-a-random-secret",
      webhookPath: "/telegram-webhook",
      webhookHost: "127.0.0.1",
      webhookPort: 8787
    }
  }
}
```

Typical local flow:

```bash
# Terminal 1
openclaw gateway --allow-unconfigured

# Terminal 2
ngrok http 8787

# Terminal 3
npm run dev
```

Then:

1. Set `webhookUrl` to the ngrok HTTPS URL plus `/telegram-webhook`.
2. Set the `.env` public endpoint variables above so orchestrated budget-change and shutdown actions go through Kong.
3. Run `npm run smoke:test` with `SMOKE_PUBLIC_GATEWAY_BASE_URL=https://<your-ngrok-domain>.ngrok-free.app` to verify the public routes.

## CalculateBill Composite Service

The CalculateBill composite service runs as a Flask container on port `5008` and orchestrates:

- `appliance-service` for live appliance load (`/api/appliance`)
- tariff pricing (`/api/rate`) is handled by CalculateBill
- `bill-service` for period bill persistence (`/api/bills`)
- `budget-service` for cumulative monthly bill updates (`/api/budget/<user_id>`)

Endpoints exposed by the composite service:

- `GET /api/calculatebill/state` - returns in-memory cycle totals per user
- `POST /api/calculatebill/run` - executes one billing cycle (default 15 minutes)

Example run request:

```json
{
 "user_id": 1,
 "uid": "user_demo_001",
 "interval_minutes": 15,
 "sync_budget": true,
 "force_month_close": false
}
```

## ForecastBill Composite Service

The ForecastBill composite service runs as a Flask container on port `5009` and orchestrates:

- `bill-service` for same-month spend history (`/api/bills`)
- `budget-service` for budget cap and cumulative bill (`/api/budget/<user_id>`)
- `profile-service` for resident context (`/profile/<user_id>`)
- `picoclaw/forecast.py` for PicoClaw AI assessment via AI Responses API

Endpoints exposed by the composite service:

- `GET /api/forecast` - backward-compatible forecast retrieval by query params (`uid`, optional `user_id`, `profile_id`)
- `POST /api/forecast` - plan-aligned composite call that aggregates Billing + Budget + Profile before invoking PicoClaw
- `POST /api/forecastbill` - alias for `POST /api/forecast`

Forecast response includes `projectedCost`, `projectedKwh`, `riskLevel`, `daysToExceed`, `shortNarrative`, and `recommendedAppliances`.

## RabbitMQ (History Events)

- Queue name defaults to `history.events.v1`.
- Configure broker via `RABBITMQ_URL` (single URL) or `RABBITMQ_URLS` (comma-separated fallback URLs).
- Optional queue override: `HISTORY_EVENTS_QUEUE`.
- Docker compose starts RabbitMQ with management UI on `http://localhost:15672`.

## Notes

- The repo uses a demo user ID defined in `lib/shared/constants.ts`.
- UI copy, budget thresholds, and appliance states are currently simulated in the client and service layer.
- The appliance microservice replays `appliance-service/data/appliance_energy_data.csv` and advances one row every `APPLIANCE_REPLAY_INTERVAL_SECONDS` seconds.
- `app/layout.tsx` still contains the default generated metadata, so you may want to customize the page title and description next.
