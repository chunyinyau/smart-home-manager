"use client";

import React, { useState, useEffect } from 'react';
import {
  Search, LayoutDashboard, Server, Database, Wallet,
  Activity, Layers, Wrench, ShieldCheck, Settings,
  MessageSquare, Sun, Moon, Book, ChevronDown,
  ChevronRight, Zap
} from 'lucide-react';
import SpatialEnergyPanel from '@/components/SpatialEnergyPanel';

import { DisplayPayload } from '@/lib/types/display.types';
import { DEMO_UID } from '@/lib/shared/constants';

type CalculateBillRunPayload = {
  success?: boolean;
  error?: string;
  data?: {
    computed_at?: string;
    result?: {
      period_kwh?: number;
      period_cost_sgd?: number;
      monthly_total_sgd?: number;
    };
    month_close?: {
      closed?: boolean;
      reason?: string;
    };
  };
};

type CalculateBillStatePayload = {
  success?: boolean;
  error?: string;
  data?: Record<
    string,
    {
      month?: string;
      running_total?: number;
      updated_at?: string;
      closed_month?: string | null;
    }
  >;
};

export default function App() {
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [data, setData] = useState<DisplayPayload | null>(null);
  const [accruedSpendFallback, setAccruedSpendFallback] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningBillCycle, setRunningBillCycle] = useState(false);
  const [billRunResult, setBillRunResult] = useState<CalculateBillRunPayload | null>(null);
  const [billRunError, setBillRunError] = useState<string | null>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [cronState, setCronState] = useState<CalculateBillStatePayload["data"] | null>(null);
  const [cronStateLoading, setCronStateLoading] = useState(true);
  const [cronStateError, setCronStateError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timeoutId: number | null = null;

    const fetchDashboardData = async () => {
      let success = false;
      try {
        const [rateResponse, displayResponse] = await Promise.all([
          fetch('/api/rate', { cache: 'no-store' }),
          fetch(`/api/display?uid=${DEMO_UID}&profile_id=1`, { cache: 'no-store' }),
        ]);

        const ratePayload = await rateResponse.json();
        if (ratePayload.success && ratePayload.data) {
          const rateData = Array.isArray(ratePayload.data) ? ratePayload.data[0] : ratePayload.data;
          if (alive) {
            setCurrentRate(rateData?.cents_per_kwh || null);
          }
        }

        const displayPayload = await displayResponse.json();
        if (alive) {
          setData(displayPayload);
        }

        // If persisted budget is still zero after restart, show immediate CSV-derived accrual.
        const budgetCumBill = Number(displayPayload?.budget?.cum_bill ?? 0);
        if (budgetCumBill <= 0 && ratePayload?.data) {
          const accrualResponse = await fetch('/api/appliance/telemetry/accrual', {
            cache: 'no-store',
          });
          if (accrualResponse.ok) {
            const accrualPayload = await accrualResponse.json();
            const accruedKwh = Number(accrualPayload?.accruedSliceKwh ?? 0);
            const centsPerKwh = Number(
              (Array.isArray(ratePayload.data) ? ratePayload.data[0] : ratePayload.data)?.cents_per_kwh ?? 0,
            );
            if (Number.isFinite(accruedKwh) && Number.isFinite(centsPerKwh)) {
              const estimatedSpend = accruedKwh * (centsPerKwh / 100);
              if (alive) {
                setAccruedSpendFallback(Number(estimatedSpend.toFixed(2)));
              }
            }
          }
        } else if (alive) {
          setAccruedSpendFallback(null);
        }
        success = rateResponse.ok && displayResponse.ok;
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
      } finally {
        if (alive) {
          setLoading(false);
          // Healthy path polls every 5 minutes. During restart/error, retry quickly.
          const nextDelayMs = success ? 300000 : 5000;
          timeoutId = window.setTimeout(fetchDashboardData, nextDelayMs);
        }
      }
    };

    fetchDashboardData();

    return () => {
      alive = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timeoutId: number | null = null;

    const fetchCronState = async () => {
      let success = false;
      try {
        const response = await fetch('/api/calculatebill/state', {
          cache: 'no-store',
        });
        const payload = (await response.json()) as CalculateBillStatePayload;

        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }

        if (!alive) {
          return;
        }

        const stateData = payload.data ?? {};
        setCronState(stateData);
        setCronStateError(null);
        success = Object.keys(stateData).length > 0;
      } catch (error) {
        if (!alive) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        setCronStateError(message);
      } finally {
        if (alive) {
          setCronStateLoading(false);
          const nextDelayMs = success ? 300000 : 5000;
          timeoutId = window.setTimeout(fetchCronState, nextDelayMs);
        }
      }
    };

    fetchCronState();

    return () => {
      alive = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const runCalculateBill = async () => {
    setRunningBillCycle(true);
    setBillRunError(null);
    setBillRunResult(null);

    try {
      const response = await fetch('/api/calculatebill/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: 1,
          uid: DEMO_UID,
          interval_minutes: 5,
          sync_budget: true,
        }),
      });

      const payload = (await response.json()) as CalculateBillRunPayload;
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }

      setBillRunResult(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setBillRunError(message);
    } finally {
      setRunningBillCycle(false);
    }
  };

  const budget = data?.budget;
  const fallbackMonth = new Date().toISOString().slice(0, 7);
  const displayedAccruedSpend = (() => {
    const persisted = Number(budget?.cum_bill ?? 0);
    if (persisted > 0) {
      return persisted;
    }
    return accruedSpendFallback ?? 0;
  })();
  const profile = data?.profile;
  const history = data?.history || [];
  const cronUserState = cronState?.["1"];

  return (
    <div className="flex h-screen bg-white text-gray-900 font-sans selection:bg-blue-100">
      {/* SIDEBAR */}
      <aside className="w-[260px] border-r border-gray-200 flex flex-col justify-between hidden md:flex">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-gray-200">
            <div className="w-6 h-6 bg-blue-600 text-white flex items-center justify-center font-bold text-xs rounded shadow-sm mr-3">
              P
            </div>
            <span className="font-semibold text-[15px] tracking-tight">PicoClaw OS</span>
          </div>
          <div className="p-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-shadow"
              />
            </div>
          </div>
          <nav className="px-3 space-y-0.5">
            <NavItem icon={<LayoutDashboard size={18} />} label="App Dashboard" active />
            <NavItem icon={<Server size={18} />} label="Endpoints" />
            
            {/* Data Toggle */}
            <button
              onClick={() => setDataMenuOpen(!dataMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                dataMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Database className={dataMenuOpen ? 'text-blue-600' : 'text-gray-400'} size={18} />
                Data
              </div>
              <div className={`transform transition-transform duration-200 ${dataMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>

            {/* Data Submenu */}
            {dataMenuOpen && (
              <div className="pl-6 space-y-0.5 bg-gray-50 rounded-md py-2">
                <button
                  onClick={runCalculateBill}
                  disabled={runningBillCycle}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-[13px] font-medium text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Sync current billing cycle with budget"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 flex items-center justify-center text-gray-400">
                      {runningBillCycle ? '⟳' : '⟳'}
                    </div>
                    <span>{runningBillCycle ? 'Syncing...' : 'Sync Bill'}</span>
                  </div>
                  {billRunResult && !billRunError && (
                    <div className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center x-sm text-white"></div>
                  )}
                  {billRunError && (
                    <div className="w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center text-xs text-white">✕</div>
                  )}
                </button>
              </div>
            )}

            <NavItem icon={<Wallet size={18} />} label="Budgets" />
            <NavItem icon={<Activity size={18} />} label="Transactions" hasChevron />
            <NavItem icon={<Layers size={18} />} label="Orchestrations" />
            <NavItem icon={<Wrench size={18} />} label="Tools" hasChevron />
          </nav>
        </div>
        <div>
          <nav className="px-3 pb-4 space-y-0.5 border-t border-gray-100 pt-4">
            <NavItem icon={<ShieldCheck size={18} />} label="Security" />
            <NavItem icon={<Settings size={18} />} label="App Settings" />
          </nav>
          <div className="p-4 border-t border-gray-200 flex justify-between items-center">
            <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-md w-full justify-center">
              <MessageSquare size={16} />
              Share feedback
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white">
        <header className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white">
          <div className="flex items-center text-sm font-medium text-gray-600 cursor-pointer">
            <div className="flex items-center gap-2 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors">
              <span className="w-5 h-5 bg-gray-100 border border-gray-200 rounded-full flex items-center justify-center text-xs">E</span>
              Elroy&apos;s Team
              <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold text-gray-500">Free</span>
            </div>
            <ChevronRight className="w-4 h-4 mx-2 text-gray-400" />
            <div className="flex items-center gap-2 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors">
              <Server className="w-4 h-4" />
              Singapore-01
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Live Electricity Rate Indicator */}
            <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-1.5 rounded-md shadow-sm">
              <Zap size={15} className="text-emerald-600" />
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase text-emerald-600 leading-none">Live SP Tariff</span>
                <span className="text-sm font-semibold text-emerald-700 leading-none mt-0.5">
                  {currentRate ? `${currentRate}¢ / kWh` : 'Loading...'}
                </span>
              </div>
            </div>

            <div className="flex items-center bg-gray-100 rounded-full p-1 border border-gray-200">
              <button className="p-1 rounded-full bg-white shadow-sm text-gray-800">
                <Sun size={14} />
              </button>
              <button className="p-1 rounded-full text-gray-400 hover:text-gray-600">
                <Moon size={14} />
              </button>
            </div>
            <button className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50">
              <Book size={16} /> Docs
            </button>
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm border border-blue-200">
              ET
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 max-w-[1400px] mx-auto w-full">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Singapore-01 Node</h1>
            {loading && <span className="text-sm text-blue-600 animate-pulse font-medium">Syncing with Microservices...</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard 
              value={`$${displayedAccruedSpend.toFixed(2)}`} 
              label="Accrued Spend" 
              timeframe="This Month" 
            />
            <MetricCard
              value={`${profile?.baseline_monthly_kwh || '---'} kWh`}
              label="Baseline Target"
              timeframe={`HDB Type ${profile?.hdb_type || '?'}`}
            />
            <MetricCard
              value={
                !budget ? '---' :
                budget.cum_bill > budget.budget_cap ? 'CRITICAL' :
                budget.cum_bill > budget.budget_cap * 0.8 ? 'WARNING' : 'SAFE'
              }
              label="Budget Status"
              timeframe="Live Sync"
              valueColor={
                !budget ? 'text-gray-400' :
                budget.cum_bill > budget.budget_cap ? 'text-rose-600' :
                budget.cum_bill > budget.budget_cap * 0.8 ? 'text-amber-500' : 'text-emerald-600'
              }
            />
            <MetricCard 
              value={`$${budget?.budget_cap?.toFixed(0) || '---'}`} 
              label="Monthly Cap" 
              timeframe="User Setting" 
            />
          </div>

          <div className="grid grid-cols-1 gap-6 mb-8">
             <SpatialEnergyPanel appliances={data?.appliances} />
          </div>

          {/* NEW: Recent Logs Section */}
          <div className="mt-4 border border-gray-200 rounded-2xl bg-white p-6 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
              <Activity className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold text-gray-900">Recent System Activities</h2>
            </div>
            
            <div className="space-y-4">
              {history.length > 0 ? (
                history.slice(0, 5).map((log) => (
                  <div key={log.log_id} className="flex items-start gap-4 p-3 hover:bg-gray-50 rounded-lg transition-colors border-l-2 border-blue-500">
                    <div className="min-w-[140px] text-[12px] font-bold text-gray-400 uppercase tracking-tight">
                      {new Date(log.occurred_at).toLocaleString()}
                    </div>
                    <div className="text-sm font-medium text-gray-700">
                      {log.message}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-400 italic font-medium">
                  No activity logs found.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 border border-gray-200 rounded-2xl bg-white p-6 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-6 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2">
                <Server className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-bold text-gray-900">Live Billing Status</h2>
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Auto refresh every 5 Minutes
              </span>
            </div>

            {cronStateLoading ? (
              <div className="text-sm text-gray-500">Loading cron state...</div>
            ) : cronStateError ? (
              <div className="text-sm text-rose-600">Unable to load cron state: {cronStateError}</div>
            ) : !cronUserState ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Current Month</div>
                  <div className="text-xl font-semibold text-gray-900 mt-1">{fallbackMonth}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Running Total</div>
                  <div className="text-xl font-semibold text-emerald-700 mt-1">
                    ${displayedAccruedSpend.toFixed(4)}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Last Updated</div>
                  <div className="text-sm font-semibold text-gray-900 mt-2">
                    {data?.fetched_at ? new Date(data.fetched_at).toLocaleString() : 'Warming up'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Current Month</div>
                  <div className="text-xl font-semibold text-gray-900 mt-1">{cronUserState.month ?? 'Unknown'}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Running Total</div>
                  <div className="text-xl font-semibold text-emerald-700 mt-1">
                    ${Number(cronUserState.running_total ?? 0).toFixed(4)}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Last Updated</div>
                  <div className="text-sm font-semibold text-gray-900 mt-2">
                    {cronUserState.updated_at
                      ? new Date(cronUserState.updated_at).toLocaleString()
                      : 'Unknown'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  hasChevron,
  href = "#",
}: {
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  active?: boolean;
  hasChevron?: boolean;
  href?: string;
}) {
  return (
    <a
      href={href}
      className={`flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
        active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      }`}
    >
      <div className="flex items-center gap-3">
        {React.cloneElement(icon, { className: active ? 'text-blue-600' : 'text-gray-400' })}
        {label}
      </div>
      {hasChevron && <ChevronDown className="w-4 h-4 text-gray-400" />}
    </a>
  );
}

function MetricCard({ value, label, timeframe, valueColor = 'text-gray-900' }: { value: string | number; label: string; timeframe: string; valueColor?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-white flex flex-col justify-between h-[120px] shadow-sm hover:shadow transition-shadow">
      <div className={`text-[32px] md:text-[40px] leading-none font-semibold ${valueColor} truncate`}>{value}</div>
      <div className="flex justify-between items-end mt-4">
        <span className="text-sm font-medium text-gray-900 truncate">{label}</span>
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{timeframe}</span>
      </div>
    </div>
  );
}
