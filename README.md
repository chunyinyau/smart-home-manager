# Wattch

Wattch is a smart home energy management demo built with Next.js. It shows how a Telegram-style orchestration flow, appliance controls, budget tracking, and forecasting can work together in one dashboard.

## What It Does

- Tracks budget, projected spend, and risk level.
- Displays appliance state and simulated shutdown actions.
- Surfaces alerts with acknowledgement and auto-cutoff behavior.
- Exposes API routes for budget, appliance, history, profile, rate, and forecast data.
- Includes a Telegram orchestrator flow for handling user intents.
- Runs the rate and appliance backends as Dockerized microservices.

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Lucide icons

## Project Structure

- `app/page.tsx` - main dashboard UI
- `app/layout.tsx` - app shell and metadata
- `app/api/*` - route handlers for budget, forecast, appliance, history, profile, rate, and orchestrator flows
- `components/SpatialEnergyPanel.tsx` - spatial appliance visualization
- `lib/services/*` - business logic and repository helpers
- `lib/orchestrator/*` - Telegram intent parsing and orchestration
- `lib/clients/*` - lightweight client stubs used by the demo

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Run the development server:

```bash
npm run dev
```

3. Start the backend microservices:

```bash
docker compose up --build -d
```

4. Open the app:

```text
http://localhost:3000
```

## Scripts

- `npm run dev` - start the local development server
- `npm run build` - build the production app
- `npm run start` - run the production build
- `npm run lint` - run ESLint

## API Routes

The app includes the following route handlers:

- `GET /api/budget`
- `POST /api/budget/cap`
- `GET /api/appliance`
- `POST /api/appliance/[aid]/shutdown`
- `PATCH /api/appliance/[aid]/priority`
- `GET /api/history`
- `GET /api/profile`
- `GET /api/rate`
- `GET /api/forecast`
- `POST /api/orchestrator`

## Notes

- The repo uses a demo user ID defined in `lib/shared/constants.ts`.
- UI copy, budget thresholds, and appliance states are currently simulated in the client and service layer.
- `app/layout.tsx` still contains the default generated metadata, so you may want to customize the page title and description next.

