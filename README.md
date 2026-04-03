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
- `npm run smoke:test` - run API smoke checks for rate, rate sync, budget, and telemetry status

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
- `SMOKE_RATE_SERVICE_URL` (default: `http://localhost:5001`)
- `SMOKE_APPLIANCE_SERVICE_URL` (default: `http://localhost:5002`)
- `SMOKE_BILL_SERVICE_URL` (default: `http://localhost:5003`)
- `SMOKE_BUDGET_SERVICE_URL` (default: `http://localhost:5004`)
- `SMOKE_HISTORY_SERVICE_URL` (default: `http://localhost:5005`)
- `SMOKE_CALCULATEBILL_SERVICE_URL` (default: `http://localhost:5008`)

The smoke test now verifies all existing microservices (rate, appliance, bill, budget, history, and calculatebill) through direct service checks, in addition to key Next.js API proxy routes.
The app-level rate sync check treats `429` and `502` as tolerated warnings because the data.gov.sg upstream can be rate-limited or temporarily unavailable.

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

## CalculateBill Composite Service

The CalculateBill composite service runs as a Flask container on port `5008` and orchestrates:

- `appliance-service` for live appliance load (`/api/appliance`)
- `rate-service` for tariff (`/api/rate`)
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
