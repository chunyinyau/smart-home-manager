#### Services

| Service | Layer | What it does | Owns |
| :---- | :---- | :---- | :---- |
| Appliance | Atomic | Source of truth for every appliance \- registers devices, tracks on/off state, stores priority profile, records live usage readings per appliance | **Appliance DB** |
| Rate | Atomic | Holds the quarterly SP Energy tariff. Returns current rate per kWh. Updated once per month \- no logic, pure lookup | **Rate DB** |
| Budget | Atomic | Stores each user's monthly cap and receives the end-of-month cumulative bill dump from CalculateBillService. | **Budget DB** |
| History | Atomic | Append-only audit log. Receives log entries asynchronously from the composite microservice service via RabbitMQ ~~POST /history/log~~. Never mutate entries. Read by Dashboard for activity feed | **History DB** |
| Profile | Atomic | Stores flat metadata \- HDB type, room count, number of residents. Baseline kWh per HDB type is pre-seeded static data. No runtime computation | **Profile DB** |
| CalculateBill | Composite | Runs every 15 min (cron). Calls ApplianceService for kWh readings, calls RateService for tariff, computes periodCostSGD, accumulates into running monthly total. On the last day of the billing cycle, dumps final total to BudgetService as cum\_bill, then resets current spend to 0 | No DB |
| Forecast | Composite | Calls CalculateBillService for spend history, BudgetService for the cap, RateService for tariff, then calls PicoClaw AI to produce risk level, days-to-exceed, and narrative. Returns the assembled forecast | No DB \- stateless |
| Automation | Composite | Triggered by cron (every 15 min) and by BudgetExceeded event from ForecastService. Calls ForecastService to check risk, calls ApplianceService for sheddable ON appliances ranked by priority, issues PUT state=OFF per appliance, writes to HistoryService | No DB \- stateless |
| Display | Composite | Composition layer for the Web UI. Fans out five parallel GET calls to ApplianceService, ForecastService, BudgetService, HistoryService, ProfileService. Merges all responses into one unified payload. The Web UI calls only this service. | No DB \- stateless  |
| UpdateBudget | Composite | Composition layer for the Tele Bot.  | No DB \- stateless |

#### 

#### DB

| DB | Field | Type | Notes |
| :---- | :---- | :---- | :---- |
| **Appliance (Info Table)** | appliance\_id | INT PK | Auto-increment |
|  | user\_id | INT FK | References User |
|  | name | VARCHAR(50) | e.g. Living Room Aircon |
|  | priority | ENUM | CRITICAL / HIGH / LOW \- User Config |
| **Appliance (Readings Table)** | id | INT PK | Auto-increment |
|  | appliance\_id | INT FK | References appliance |
|  | status | ENUM | ON / OFF/ UNAVAILABLE |
|  | energy\_consumption | DECIMAL | Cumulative energy |
|  | recorded\_at | TIMESTAMP | When the reading was actually taken by the device |
| **Rate** | rate\_id | INT PK |  |
|  | cents\_per\_kwh | DECIMAL | e.g. 0.2988 |
|  | month\_year | STR | e.g. 2026-03 |
| **Budget (Budget Table)** | budget\_id | INT PK |  |
|  | user\_id | INT FK | References User |
|  | budget\_cap | DECIMAL | Monthly cap set by user, e.g. 100.00 |
|  | cum\_bill | DECIMAL | The total dumped from last month's final calculation |
| **Billing** send from CalculateBill | bill\_id | INT PK |  |
|  | user\_id | INT FK | References User |
|  | period\_cost\_sgd | DECIMAL | period\_kwh multiplied by the current tariff |
|  | period\_kwh | DECIMAL | Total kWh used by all appliances in this 15-min window |
|  | computed\_at | DATETIME | Timestamp of when CalculateBill cron job ran |
|  | billing\_period\_start | DATE | First day of current billing month \- used to scope monthly aggregate queries and detect month rollover |
|  **History** |  log\_id |  INT PK |  |
|  | user\_id | INT FK | References User |
|  | message | TEXT | Human-readable description |
|  | occurred\_at | DATETIME | Append-only \- never updated |
| **Profile** | profile\_id | INT PK |  |
|  | user\_id | INT FK | References User |
|  | hdb\_type | ENUM | 3-Room / 4-Room / 5-Room / Executive |
|  | baseline\_monthly\_kwh | DECIMAL | Pre-seeded by HDB type \- static, not computed |

