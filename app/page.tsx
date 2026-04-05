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
  const [suggestedActionsOpen, setSuggestedActionsOpen] = useState(false);
  const [cronState, setCronState] = useState<CalculateBillStatePayload["data"] | null>(null);
  const [cronStateLoading, setCronStateLoading] = useState(true);
  const [cronStateError, setCronStateError] = useState<string | null>(null);
  const [budgetMenuOpen, setBudgetMenuOpen] = useState(false);
  const [automationMenuOpen, setAutomationMenuOpen] = useState(false);
  const [budgetCapInput, setBudgetCapInput] = useState<string>('');
  const [updatingBudget, setUpdatingBudget] = useState(false);
  const [budgetActionFeedback, setBudgetActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [automatingState, setAutomatingState] = useState(false);
  const [automationFeedback, setAutomationFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [applianceMenuOpen, setApplianceMenuOpen] = useState(false);
  const [togglingApplianceId, setTogglingApplianceId] = useState<string | null>(null);

  const fetchDashboardData = async (isManual = false) => {
    try {
      const [rateResponse, displayResponse] = await Promise.all([
        fetch('/api/rate', { cache: 'no-store' }),
        fetch(`/api/display?uid=${DEMO_UID}&profile_id=1`, { cache: 'no-store' }),
      ]);

      const ratePayload = await rateResponse.json();
      if (ratePayload.success && ratePayload.data) {
        const rateData = Array.isArray(ratePayload.data) ? ratePayload.data[0] : ratePayload.data;
        setCurrentRate(rateData?.cents_per_kwh || null);
      }

      const displayPayload = await displayResponse.json();
      setData(displayPayload);

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
            setAccruedSpendFallback(Number(estimatedSpend.toFixed(4)));
          }
        }
      } else {
        setAccruedSpendFallback(null);
      }
      return rateResponse.ok && displayResponse.ok;
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
      return false;
    } finally {
      if (!isManual) setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    let timeoutId: number | null = null;

    const runPoll = async () => {
      const success = await fetchDashboardData();
      if (alive) {
        const nextDelayMs = success ? 300000 : 5000;
        timeoutId = window.setTimeout(runPoll, nextDelayMs);
      }
    };

    runPoll();

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

  const handleUpdateBudget = async () => {
    if (!budgetCapInput || isNaN(Number(budgetCapInput))) return;
    setUpdatingBudget(true);
    setBudgetActionFeedback(null);
    try {
      const response = await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'set_budget',
          params: { uid: DEMO_UID, monthlyCap: Number(budgetCapInput) }
        }),
      });
      const result = await response.json();
      if (!response.ok || (result.accepted === false)) {
        setBudgetActionFeedback({ type: 'error', message: result.message || result.error || 'Failed to update budget' });
      } else {
        setBudgetActionFeedback({ type: 'success', message: 'Budget updated successfully' });
        // Force refresh or update local state
        setTimeout(() => setBudgetMenuOpen(false), 2000);
      }
    } catch (err) {
      setBudgetActionFeedback({ type: 'error', message: 'Network error occurred' });
    } finally {
      setUpdatingBudget(false);
    }
  };

  const handleAutoShutdown = async () => {
    setAutomatingState(true);
    setAutomationFeedback(null);
    try {
      const response = await fetch('/api/request-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: DEMO_UID, targetState: 'OFF' }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        setAutomationFeedback({ type: 'error', message: result.error || 'Automation failed' });
      } else {
        setAutomationFeedback({ type: 'success', message: result.message || 'Shut down heaviest load' });
        setTimeout(() => setAutomationMenuOpen(false), 2000);
      }
    } catch (err) {
      setAutomationFeedback({ type: 'error', message: 'Network error occurred' });
    } finally {
      setAutomatingState(false);
    }
  };

  const handleToggleAppliance = async (aid: string, currentState: string) => {
    const targetState = currentState.toUpperCase() === 'ON' ? 'OFF' : 'ON';
    setTogglingApplianceId(aid);
    try {
      const response = await fetch('/api/request-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uid: DEMO_UID,
          aid: aid,
          targetState: targetState,
        }),
      });

      if (response.ok) {
        // Instant visual feedback: silent re-fetch
        await fetchDashboardData(true);
      }
    } catch (err) {
      console.error("Toggle appliance failure:", err);
    } finally {
      setTogglingApplianceId(null);
    }
  };

  const budget = data?.budget;
  const forecast = data?.forecast;
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
  const budgetStatusValue = forecast?.riskLevel ?? '---';
  const budgetStatusColor =
    !forecast ? 'text-gray-400' :
    forecast.riskLevel === 'CRITICAL' ? 'text-rose-600' :
    forecast.riskLevel === 'HIGH' ? 'text-amber-500' :
    'text-emerald-600';
  const suggestedAppliances = Array.from(
    new Set(
      [
        ...(Array.isArray(forecast?.recommendedAppliances) ? forecast.recommendedAppliances : []),
        ...(Array.isArray(forecast?.recommendations) ? forecast.recommendations : []),
      ]
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0),
    ),
  );

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
            
            {/* 1. Data Sync Panel */}
            <button
              onClick={() => setDataMenuOpen(!dataMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                dataMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Database className={dataMenuOpen ? 'text-blue-600' : 'text-gray-400'} size={18} />
                Billing Sync
              </div>
              <div className={`transform transition-transform duration-200 ${dataMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {dataMenuOpen && (
              <div className="pl-6 space-y-0.5 bg-gray-50 rounded-md py-2 px-2 m-1 border border-gray-100">
                <p className="text-[11px] text-gray-400 uppercase font-bold mb-2 ml-1">Manual Controls</p>
                <button
                  onClick={runCalculateBill}
                  disabled={runningBillCycle}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-[13px] font-medium text-gray-600 hover:text-gray-900 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors border border-transparent hover:border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <div className={runningBillCycle ? 'animate-spin' : ''}>⟳</div>
                    <span>{runningBillCycle ? 'Syncing...' : 'Force Bill Run'}</span>
                  </div>
                  {billRunResult && !billRunError && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>}
                </button>
              </div>
            )}

            {/* 2. Budget Control Panel */}
            <button
              onClick={() => setBudgetMenuOpen(!budgetMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                budgetMenuOpen ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Wallet className={budgetMenuOpen ? 'text-emerald-600' : 'text-gray-400'} size={18} />
                Projected Budget
              </div>
              <div className={`transform transition-transform duration-200 ${budgetMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {budgetMenuOpen && (
              <div className="pl-6 space-y-2 bg-emerald-50/30 rounded-md py-3 px-3 m-1 border border-emerald-100">
                <p className="text-[11px] text-emerald-600 uppercase font-bold">Adjust Monthly Cap</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-2 text-gray-400 text-xs">$</span>
                    <input 
                      type="text" 
                      value={budgetCapInput}
                      onChange={(e) => setBudgetCapInput(e.target.value)}
                      placeholder="Amount" 
                      className="w-full pl-6 pr-2 py-1.5 text-xs bg-white border border-emerald-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <button 
                    disabled={updatingBudget || !budgetCapInput}
                    onClick={handleUpdateBudget}
                    className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {updatingBudget ? '...' : 'Set'}
                  </button>
                </div>
                {budgetActionFeedback && (
                  <p className={`text-[10px] font-medium leading-tight ${budgetActionFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {budgetActionFeedback.message}
                  </p>
                )}
              </div>
            )}

            {/* 3. Smart Automation Panel */}
            <button
              onClick={() => setAutomationMenuOpen(!automationMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                automationMenuOpen ? 'bg-amber-50 text-amber-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Zap className={automationMenuOpen ? 'text-amber-600' : 'text-gray-400'} size={18} />
                Active Automation
              </div>
              <div className={`transform transition-transform duration-200 ${automationMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {automationMenuOpen && (
              <div className="pl-6 space-y-3 bg-amber-50/30 rounded-md py-3 px-3 m-1 border border-amber-100">
                <p className="text-[11px] text-amber-600 uppercase font-bold">Interventions</p>
                <button
                  disabled={automatingState}
                  onClick={handleAutoShutdown}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-md text-[12px] font-bold text-amber-700 hover:bg-amber-50 transition-all shadow-sm active:scale-[0.98]"
                >
                  {automatingState ? '⟳ Processing...' : 'Auto-Shutdown Load'}
                </button>
                {automationFeedback && (
                  <p className={`text-[10px] font-medium leading-tight ${automationFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {automationFeedback.message}
                  </p>
                )}
              </div>
            )}

            {/* 4. Appliance Monitor Panel */}
            <button
              onClick={() => setApplianceMenuOpen(!applianceMenuOpen)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${
                applianceMenuOpen ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <LayoutDashboard className={applianceMenuOpen ? 'text-indigo-600' : 'text-gray-400'} size={18} />
                Device Registry
              </div>
              <div className={`transform transition-transform duration-200 ${applianceMenuOpen ? 'rotate-180' : ''}`}>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </button>
            {applianceMenuOpen && (
              <div className="pl-6 space-y-1 bg-indigo-50/20 rounded-md py-2 px-2 m-1 border border-indigo-100">
                <p className="text-[11px] text-indigo-600 uppercase font-bold mb-2 ml-1">Live Appliance Stack</p>
                <div className="space-y-0.5">
                  {(data?.appliances ?? [])
                    .sort((a, b) => (b.currentWatts || 0) - (a.currentWatts || 0))
                    .map((app) => (
                      <div key={app.id} className="flex items-center justify-between p-2 rounded hover:bg-white transition-all group border border-transparent hover:border-indigo-100">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-bold text-gray-700 leading-none">{app.name}</span>
                          <span className="text-[9px] text-gray-400 font-medium uppercase tracking-[0.05em] mt-1 line-clamp-1">{app.room} • {app.currentWatts.toFixed(0)}W</span>
                        </div>
                        <button
                          onClick={() => handleToggleAppliance(app.id, app.state)}
                          disabled={togglingApplianceId === app.id}
                          className={`relative w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${
                            app.state?.toUpperCase() === 'ON' ? 'bg-emerald-500' : 'bg-gray-300'
                          } ${togglingApplianceId === app.id ? 'opacity-50' : ''}`}
                        >
                          <div className={`w-3 h-3 bg-white rounded-full transition-transform transform shadow-sm ${
                            app.state?.toUpperCase() === 'ON' ? 'translate-x-4' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    ))}
                </div>
                <p className="text-[9px] text-indigo-500/60 p-2 mt-2 border-t border-indigo-100 italic">
                  * Sorted by live energy consumption.
                </p>
              </div>
            )}
          </nav>
        </div>
        <div>
          <div className="px-6 py-4 border-t border-gray-100 italic text-[10px] text-gray-400 leading-tight">
            Resident Control Center v1.0 <br /> Managed via Composite Microservices
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white">
        <header className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white overflow-x-auto no-scrollbar">
          <div className="flex items-center text-sm font-medium text-gray-600 gap-2 min-w-max">
            <div className="flex items-center gap-2 border border-blue-200 bg-blue-50/50 px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors">
              <span className="w-5 h-5 bg-blue-600 text-white border border-blue-600 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm">W</span>
              <span className="font-bold text-blue-900 tracking-tight">waatch-ing</span>
              <span className="bg-blue-600 px-1.5 py-0.5 rounded text-[9px] uppercase font-black text-white shadow-sm">Active</span>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
            <div className="flex items-center gap-2 border border-gray-200 px-3 py-1.5 rounded-md bg-white">
              <Activity className="w-4 h-4 text-emerald-500" />
              <span className="text-gray-900">{data?.appliances?.filter(a => a.state?.toUpperCase() === 'ON').length || 0} Appliances Running</span>
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

            <a 
              href="#recent-activities"
              className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
            >
              <Database size={16} /> Logs
            </a>
            <div className="flex items-center gap-3 pl-2 border-l border-gray-200">
              <div className="flex flex-col items-end hidden sm:flex">
                <span className="text-xs font-bold text-gray-900 leading-none">{profile?.name || 'Guest User'}</span>
                <span className="text-[10px] font-medium text-gray-400 leading-none mt-1">Resident</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-xs border border-blue-700 shadow-sm">
                {(profile?.name || 'G').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 max-w-[1400px] mx-auto w-full">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Your Home</h1>
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
              value={budgetStatusValue}
              label="Budget Status"
              timeframe="Live Sync"
              valueColor={budgetStatusColor}
            />
            <MetricCard 
              value={`$${budget?.budget_cap?.toFixed(0) || '---'}`} 
              label="Monthly Cap" 
              timeframe="User Setting" 
            />
          </div>

          <div className="mb-8 border border-gray-200 rounded-2xl bg-white p-6 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 mb-6 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-bold text-gray-900">Forecast Outlook</h2>
              </div>
              <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
                Forecast
              </span>
            </div>

            {!forecast ? (
              <div className="text-sm text-gray-500">Forecast data is not available yet.</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                    <div className="text-xs uppercase tracking-wider text-gray-500">Recommendation</div>
                    <div className="mt-3 text-base font-medium leading-7 text-gray-800">
                      {forecast.shortNarrative}
                    </div>
                    <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <ForecastStat
                        label="Projected Spend"
                        value={`$${forecast.projectedCost.toFixed(2)}`}
                      />
                      <ForecastStat
                        label="Projected Usage"
                        value={`${forecast.projectedKwh.toFixed(1)} kWh`}
                      />
                      <ForecastStat
                        label="Days To Exceed"
                        value={forecast.daysToExceed === null ? 'N/A' : String(forecast.daysToExceed)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wider text-gray-500">Forecast Risk</div>
                      <div className={`text-2xl font-semibold mt-2 ${budgetStatusColor}`}>
                        {forecast.riskLevel}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wider text-gray-500">Month</div>
                      <div className="text-xl font-semibold text-gray-900 mt-2">{forecast.month}</div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs uppercase tracking-wider text-gray-500">Generated At</div>
                      <div className="text-sm font-semibold text-gray-900 mt-2">
                        {new Date(forecast.generatedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <button
                    type="button"
                    onClick={() => setSuggestedActionsOpen((open) => !open)}
                    aria-expanded={suggestedActionsOpen}
                    aria-controls="suggested-actions-panel"
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <div className="text-xs uppercase tracking-wider text-blue-600">Suggested Actions</div>
                      <div className="mt-1 text-sm font-semibold text-blue-700">Appliances to Turn Off</div>
                    </div>
                    <ChevronDown
                      className={`w-5 h-5 text-blue-600 transition-transform duration-300 ${
                        suggestedActionsOpen ? 'rotate-180' : 'rotate-0'
                      }`}
                    />
                  </button>

                  <div
                    id="suggested-actions-panel"
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      suggestedActionsOpen
                        ? 'max-h-96 opacity-100 mt-4 pt-3 border-t border-blue-200'
                        : 'max-h-0 opacity-0'
                    }`}
                  >
                    {suggestedAppliances.length === 0 ? (
                      <div className="text-sm text-blue-600/80">No appliance shutdown suggestions available yet.</div>
                    ) : (
                      <ul className="space-y-2">
                        {suggestedAppliances.map((item) => (
                          <li key={item} className="text-sm text-blue-700 leading-6">
                            • {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 mb-8">
             <SpatialEnergyPanel appliances={data?.appliances} />
          </div>

          {/* NEW: Recent Logs Section */}
          <div id="recent-activities" className="mt-4 border border-gray-200 rounded-2xl bg-white p-6 shadow-sm overflow-hidden scroll-mt-6">
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

function ForecastStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-2 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
