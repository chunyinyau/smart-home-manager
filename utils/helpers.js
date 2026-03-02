// Utility functions for the dashboard
export const executeAutoCutoff = (appId, appliances, setAppliances, setBudget) => {
  setAppliances((apps) =>
    apps.map((app) =>
      app.id === appId ? { ...app, state: 'OFF', draw: 0 } : app
    )
  );
  setBudget((prev) => ({
    ...prev,
    projected: prev.projected - 30,
    risk_level: prev.projected - 30 < 1000 ? 'SAFE' : 'HIGH',
  }));
};

export const handleUserAck = (alertId, appId, action, alerts, setAlerts, executeAutoCutoff) => {
  setAlerts(
    alerts.map((a) =>
      a.id === alertId
        ? { ...a, status: `RESOLVED_USER_${action.toUpperCase()}`, ttl: 0 }
        : a
    )
  );
  if (action === 'off') {
    executeAutoCutoff(appId);
  }
};