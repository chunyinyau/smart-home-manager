"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Clock3, RefreshCw, RotateCcw, PlayCircle, Database } from "lucide-react";

type TelemetryRow = Record<string, string | number | null>;

type TelemetryStatus = {
  completed: boolean;
  currentIndex: number;
  totalRows: number;
  intervalSeconds: number;
  csvPath: string;
  statePath: string;
  currentRow: TelemetryRow | null;
  nextRow: TelemetryRow | null;
};

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  return value;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}

export default function TelemetryReplayPanel() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/appliance/telemetry/status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load telemetry status");
      }
      setStatus(payload as TelemetryStatus);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load telemetry status");
    } finally {
      setLoading(false);
    }
  };

  const stepTelemetry = async (path: string, method: "POST") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error ?? "Telemetry action failed");
      }
      await loadStatus();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Telemetry action failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  const currentRow = status?.currentRow;
  const nextRow = status?.nextRow;
  const progress = status && status.totalRows > 0 ? ((status.currentIndex + 1) / status.totalRows) * 100 : 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Database className="h-5 w-5 text-gray-500" />
            Telemetry Replay
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Current slice from appliance-service. It advances every {status?.intervalSeconds ?? 300} seconds.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            disabled={loading || busy}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void stepTelemetry("/api/appliance/telemetry/advance", "POST")}
            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
            disabled={busy}
          >
            <PlayCircle className="h-4 w-4" />
            Advance
          </button>
          <button
            type="button"
            onClick={() => void stepTelemetry("/api/appliance/telemetry/reset", "POST")}
            className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            disabled={busy}
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !status ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
          Loading telemetry status...
        </div>
      ) : (
        <>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Row" value={`${(status?.currentIndex ?? 0) + 1} / ${status?.totalRows ?? 0}`} />
            <Metric label="Slice kWh" value={formatValue(currentRow?.total_slice_kwh)} />
            <Metric label="Timestamp" value={formatValue(currentRow?.timestamp)} />
            <Metric label="Replay Status" value={status?.completed ? "Completed" : "Streaming"} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Clock3 className="h-4 w-4 text-gray-500" />
                Current Slice
              </div>
              {currentRow ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {[
                    ["aircon_w", currentRow.aircon_w],
                    ["purifier_w", currentRow.purifier_w],
                    ["fan_w", currentRow.fan_w],
                    ["tv_w", currentRow.tv_w],
                    ["charger_w", currentRow.charger_w],
                    ["fridge_w", currentRow.fridge_w],
                  ].map(([label, value]) => (
                    <Metric key={String(label)} label={String(label)} value={formatValue(value)} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">No telemetry row available.</p>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Next Slice Preview</div>
              {nextRow ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4 border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Timestamp</span>
                    <span className="font-medium text-gray-900">{formatValue(nextRow.timestamp)}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Slice kWh</span>
                    <span className="font-medium text-gray-900">{formatValue(nextRow.total_slice_kwh)}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Aircon</span>
                    <span className="font-medium text-gray-900">{formatValue(nextRow.aircon_w)} W</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500">Fridge</span>
                    <span className="font-medium text-gray-900">{formatValue(nextRow.fridge_w)} W</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No next slice yet.</p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
            Source: <span className="font-mono">{status?.csvPath}</span>
            <br />
            State: <span className="font-mono">{status?.statePath}</span>
          </div>
        </>
      )}
    </section>
  );
}
