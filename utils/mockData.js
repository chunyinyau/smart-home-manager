// Mock data for the dashboard
export const INITIAL_BUDGET = {
  cap: 1000,
  current: 880,
  projected: 1150,
  risk_level: 'HIGH', // SAFE, HIGH, CRITICAL
};

export const INITIAL_APPLIANCES = [
  { id: 'app_1', name: 'Main AC (Living)', type: 'Essential', state: 'ON', draw: 2500 },
  { id: 'app_2', name: 'Server Rack', type: 'Essential', state: 'ON', draw: 800 },
  { id: 'app_3', name: 'Entertainment Unit', type: 'Non-Essential', state: 'ON', draw: 450 },
  { id: 'app_4', name: 'Desk Lamp', type: 'Non-Essential', state: 'ON', draw: 60 },
  { id: 'app_5', name: 'Guest AC', type: 'Non-Essential', state: 'OFF', draw: 0 },
];

export const INITIAL_ALERTS = [
  {
    id: 'alt_1',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    message: 'Meter Reading OCR extracted: 452 kWh. Budget updated.',
    type: 'info',
    status: 'LOGGED',
  },
  {
    id: 'alt_2',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    message: 'Desk lamp on past 10 PM. Awaiting ACK.',
    type: 'warning',
    status: 'AWAITING_ACK',
    targetAppId: 'app_4',
    ttl: 15, // Seconds for demo purposes
  },
];