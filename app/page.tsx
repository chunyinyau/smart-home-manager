"use client";

import React, { useState, useEffect } from 'react';
import {
  Search, LayoutDashboard, Server, Database, Wallet,
  Activity, Layers, Wrench, ShieldCheck, Settings,
  MessageSquare, Sun, Moon, Book, ChevronDown,
  ChevronRight, Copy, FileText, CheckCircle2,
  AlertTriangle, Clock, Play, Download, Zap
} from 'lucide-react';
import SpatialEnergyPanel from '@/components/SpatialEnergyPanel';

interface Budget {
  cap: number;
  current: number;
  projected: number;
  risk_level: 'SAFE' | 'HIGH' | 'CRITICAL';
}

interface Appliance {
  id: string;
  name: string;
  type: string;
  state: 'ON' | 'OFF';
  draw: number;
}

interface Alert {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'critical';
  status: string;
  targetAppId?: string;
  ttl?: number;
}

const INITIAL_BUDGET: Budget = {
  cap: 1000,
  current: 880,
  projected: 1150,
  risk_level: 'HIGH',
};

const INITIAL_APPLIANCES: Appliance[] = [
  { id: 'app_1', name: 'Main AC (Living)', type: 'Essential', state: 'ON', draw: 2500 },
  { id: 'app_2', name: 'Server Rack', type: 'Essential', state: 'ON', draw: 800 },
  { id: 'app_3', name: 'Entertainment Unit', type: 'Non-Essential', state: 'ON', draw: 450 },
  { id: 'app_4', name: 'Desk Lamp', type: 'Non-Essential', state: 'ON', draw: 60 },
  { id: 'app_5', name: 'Guest AC', type: 'Non-Essential', state: 'OFF', draw: 0 },
];

const INITIAL_ALERTS: Alert[] = [
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
    ttl: 15,
  },
];

export default function App() {
  const [budget, setBudget] = useState<Budget>(INITIAL_BUDGET);
  const [appliances, setAppliances] = useState<Appliance[]>(INITIAL_APPLIANCES);
  const [alerts, setAlerts] = useState<Alert[]>(INITIAL_ALERTS);
  const [rescueStage, setRescueStage] = useState<number>(0);
  const [currentRate, setCurrentRate] = useState<number | null>(null);

  useEffect(() => {
    // Fetch live electricity rate from our new backend
    fetch('/api/rate')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const rateData = Array.isArray(data.data) ? data.data[0] : data.data;
          setCurrentRate(rateData?.cents_per_kwh || null);
        }
      })
      .catch(console.error);

    const timer = setInterval(() => {
      setAlerts((currentAlerts) =>
        currentAlerts.map((alert) => {
          if (alert.status === 'AWAITING_ACK' && alert.ttl && alert.ttl > 0) {
            const newTtl = alert.ttl - 1;
            if (newTtl === 0) {
              executeAutoCutoff(alert.targetAppId || '');
              return { ...alert, ttl: 0, status: 'RESOLVED_AUTO', message: `${alert.message} (Auto-Cutoff Executed)` };
            }
            return { ...alert, ttl: newTtl };
          }
          return alert;
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const executeAutoCutoff = (appId: string) => {
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

  const handleUserAck = (alertId: string, appId: string, action: 'off' | 'keep') => {
    setAlerts((alerts) =>
      alerts.map((a) =>
        a.id === alertId ? { ...a, status: `RESOLVED_USER_${action.toUpperCase()}`, ttl: 0 } : a
      )
    );
    if (action === 'off') {
      executeAutoCutoff(appId);
    }
  };

  const toggleAppliance = (appId: string) => {
    setAppliances((apps) =>
      apps.map((app) => {
        if (app.id === appId) {
          const isTurningOn = app.state === 'OFF';
          return {
            ...app,
            state: isTurningOn ? 'ON' : 'OFF',
            draw: isTurningOn ? (app.id === 'app_4' ? 60 : 450) : 0,
          };
        }
        return app;
      })
    );
  };

  const runRescueProtocol = (stage: number) => {
    setRescueStage(stage);
    if (stage === 1) {
      setAppliances((apps) =>
        apps.map((a) => (a.id === 'app_3' ? { ...a, state: 'OFF', draw: 0 } : a))
      );
      setBudget((prev) => ({ ...prev, projected: 1060 }));
    } else if (stage === 2) {
      setAppliances((apps) =>
        apps.map((a) => (a.id === 'app_4' || a.id === 'app_5' ? { ...a, state: 'OFF', draw: 0 } : a))
      );
      setBudget((prev) => ({ ...prev, projected: 1010 }));
    } else if (stage === 3) {
      setBudget((prev) => ({ ...prev, projected: 990, risk_level: 'SAFE' }));
      setAlerts((prev) => [
        {
          id: `alt_rescue_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: 'Stage C Rescue complete. Budget secured at $990.',
          type: 'success',
          status: 'RESOLVED_SYSTEM',
        },
        ...prev,
      ]);
    } else if (stage === 4) {
      setAlerts((prev) => [
        {
          id: `alt_exception_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          message: 'Budget Escalation Unresolved. Automation halted.',
          type: 'critical',
          status: 'EXCEPTION',
        },
        ...prev,
      ]);
    }
  };

  const totalDraw = appliances.reduce((sum, app) => sum + app.draw, 0);
  const activeApps = appliances.filter((a) => a.state === 'ON').length;

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
            <NavItem icon={<Database size={18} />} label="Data" hasChevron />
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
          <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Singapore-01 Node</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard value={`$${budget.current}`} label="Current Consumption" timeframe="Last 24h" />
            <MetricCard
              value={`$${budget.projected}`}
              label="Projected EOF"
              timeframe="OutSystems"
              valueColor={budget.projected > budget.cap ? 'text-rose-600' : 'text-gray-900'}
            />
            <MetricCard
              value={budget.risk_level}
              label="Budget Risk Level"
              timeframe="Live Sync"
              valueColor={
                budget.risk_level === 'CRITICAL'
                  ? 'text-rose-600'
                  : budget.risk_level === 'HIGH'
                  ? 'text-amber-500'
                  : 'text-emerald-600'
              }
            />
            <MetricCard value={`$${budget.cap}`} label="Total Cap Limit" timeframe="Monthly" />
          </div>
          <SpatialEnergyPanel />
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
      <div className={`text-[40px] leading-none font-semibold ${valueColor}`}>{value}</div>
      <div className="flex justify-between items-end mt-4">
        <span className="text-sm font-medium text-gray-900">{label}</span>
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{timeframe}</span>
      </div>
    </div>
  );
}
