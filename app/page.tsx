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

export default function App() {
  const [currentRate, setCurrentRate] = useState<number | null>(null);
  const [data, setData] = useState<DisplayPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Fetch live electricity rate
    fetch('/api/rate')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          const rateData = Array.isArray(data.data) ? data.data[0] : data.data;
          setCurrentRate(rateData?.cents_per_kwh || null);
        }
      })
      .catch(console.error);

    // 2. Fetch aggregated display data
    fetch(`/api/display?uid=${DEMO_UID}&profile_id=1`)
      .then(res => res.json())
      .then(payload => {
        setData(payload);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch display data", err);
        setLoading(false);
      });
  }, []);

  const budget = data?.budget;
  const profile = data?.profile;
  const history = data?.history || [];

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
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Singapore-01 Node</h1>
            {loading && <span className="text-sm text-blue-600 animate-pulse font-medium">Syncing with Microservices...</span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard 
              value={`$${budget?.cum_bill?.toFixed(2) || '0.00'}`} 
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
