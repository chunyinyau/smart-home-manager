import React, { useState, useEffect } from 'react';

import {

Search, LayoutDashboard, Server, Database, Wallet,

Activity, Layers, Wrench, ShieldCheck, Settings,

MessageSquare, Sun, Moon, Book, ChevronDown,

ChevronRight, Copy, FileText, CheckCircle2,

AlertTriangle, Clock, Play, Download

} from 'lucide-react';

  

// --- MOCK DATA ---

const INITIAL_BUDGET = {

cap: 1000,

current: 880,

projected: 1150,

risk_level: 'HIGH' // SAFE, HIGH, CRITICAL

};

  

const INITIAL_APPLIANCES = [

{ id: 'app_1', name: 'Main AC (Living)', type: 'Essential', state: 'ON', draw: 2500 },

{ id: 'app_2', name: 'Server Rack', type: 'Essential', state: 'ON', draw: 800 },

{ id: 'app_3', name: 'Entertainment Unit', type: 'Non-Essential', state: 'ON', draw: 450 },

{ id: 'app_4', name: 'Desk Lamp', type: 'Non-Essential', state: 'ON', draw: 60 },

{ id: 'app_5', name: 'Guest AC', type: 'Non-Essential', state: 'OFF', draw: 0 },

];

  

const INITIAL_ALERTS = [

{

id: 'alt_1',

timestamp: new Date(Date.now() - 1000 * 60 * 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),

message: 'Meter Reading OCR extracted: 452 kWh. Budget updated.',

type: 'info',

status: 'LOGGED'

},

{

id: 'alt_2',

timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),

message: 'Desk lamp on past 10 PM. Awaiting ACK.',

type: 'warning',

status: 'AWAITING_ACK',

targetAppId: 'app_4',

ttl: 15 // Seconds for demo purposes

}

];

  

export default function App() {

const [budget, setBudget] = useState(INITIAL_BUDGET);

const [appliances, setAppliances] = useState(INITIAL_APPLIANCES);

const [alerts, setAlerts] = useState(INITIAL_ALERTS);

const [rescueStage, setRescueStage] = useState(0);

  

// --- SCENARIO 2: TTL Auto-Cutoff Simulation ---

useEffect(() => {

const timer = setInterval(() => {

setAlerts(currentAlerts =>

currentAlerts.map(alert => {

if (alert.status === 'AWAITING_ACK' && alert.ttl > 0) {

const newTtl = alert.ttl - 1;

if (newTtl === 0) {

executeAutoCutoff(alert.targetAppId);

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

  

const executeAutoCutoff = (appId) => {

setAppliances(apps => apps.map(app =>

app.id === appId ? { ...app, state: 'OFF', draw: 0 } : app

));

setBudget(prev => ({

...prev,

projected: prev.projected - 30,

risk_level: prev.projected - 30 < 1000 ? 'SAFE' : 'HIGH'

}));

};

  

const handleUserAck = (alertId, appId, action) => {

setAlerts(alerts.map(a =>

a.id === alertId ? { ...a, status: `RESOLVED_USER_${action.toUpperCase()}`, ttl: 0 } : a

));

if (action === 'off') { executeAutoCutoff(appId); }

};

  

const toggleAppliance = (appId) => {

setAppliances(apps => apps.map(app => {

if (app.id === appId) {

const isTurningOn = app.state === 'OFF';

return {

...app,

state: isTurningOn ? 'ON' : 'OFF',

draw: isTurningOn ? (app.id === 'app_4' ? 60 : 450) : 0

};

}

return app;

}));

};

  

// --- SCENARIO 3: Month-End Rescue Protocol ---

const runRescueProtocol = (stage) => {

setRescueStage(stage);

if (stage === 1) {

setAppliances(apps => apps.map(a => a.id === 'app_3' ? { ...a, state: 'OFF', draw: 0 } : a));

setBudget(prev => ({ ...prev, projected: 1060 }));

} else if (stage === 2) {

setAppliances(apps => apps.map(a => a.id === 'app_4' || a.id === 'app_5' ? { ...a, state: 'OFF', draw: 0 } : a));

setBudget(prev => ({ ...prev, projected: 1010 }));

} else if (stage === 3) {

setBudget(prev => ({ ...prev, projected: 990, risk_level: 'SAFE' }));

setAlerts(prev => [{

id: `alt_rescue_${Date.now()}`,

timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),

message: 'Stage C Rescue complete. Budget secured at $990.',

type: 'success',

status: 'RESOLVED_SYSTEM'

}, ...prev]);

} else if (stage === 4) {

setAlerts(prev => [{

id: `alt_exception_${Date.now()}`,

timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),

message: 'Budget Escalation Unresolved. Automation halted.',

type: 'critical',

status: 'EXCEPTION'

}, ...prev]);

}

};

  

// --- DERIVED METRICS ---

const totalDraw = appliances.reduce((sum, app) => sum + app.draw, 0);

const activeApps = appliances.filter(a => a.state === 'ON').length;

  

return (

<div className="flex h-screen bg-white text-gray-900 font-sans selection:bg-blue-100">

{/* SIDEBAR */}

<aside className="w-[260px] border-r border-gray-200 flex flex-col justify-between hidden md:flex">

<div>

{/* Logo Area */}

<div className="h-16 flex items-center px-6 border-b border-gray-200">

<div className="w-6 h-6 bg-blue-600 text-white flex items-center justify-center font-bold text-xs rounded shadow-sm mr-3">

P

</div>

<span className="font-semibold text-[15px] tracking-tight">PicoClaw OS</span>

</div>

  

{/* Search */}

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

  

{/* Navigation */}

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

{/* TOP HEADER */}

<header className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white">

<div className="flex items-center text-sm font-medium text-gray-600 cursor-pointer">

<div className="flex items-center gap-2 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors">

<span className="w-5 h-5 bg-gray-100 border border-gray-200 rounded-full flex items-center justify-center text-xs">E</span>

Elroy's Team

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

<div className="flex items-center bg-gray-100 rounded-full p-1 border border-gray-200">

<button className="p-1 rounded-full bg-white shadow-sm text-gray-800"><Sun size={14}/></button>

<button className="p-1 rounded-full text-gray-400 hover:text-gray-600"><Moon size={14}/></button>

</div>

<button className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50">

<Book size={16} /> Docs

</button>

<div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm border border-blue-200">

ET

</div>

</div>

</header>

  

{/* CONTENT SCROLL AREA */}

<div className="flex-1 overflow-y-auto p-8 max-w-[1400px] mx-auto w-full">

{/* HEADER SECTION */}

<div className="flex justify-between items-end mb-8">

<h1 className="text-[28px] font-semibold tracking-tight text-gray-900">Singapore-01 Node</h1>

<div className="flex items-center bg-white border border-gray-200 rounded-md overflow-hidden">

<span className="px-3 py-1.5 text-xs text-gray-500 font-medium bg-gray-50 border-r border-gray-200">RabbitMQ</span>

<span className="px-3 py-1.5 text-sm font-mono text-gray-800 tracking-tight">amqps://singapore-01.rmq.cloud</span>

<button className="px-3 py-1.5 border-l border-gray-200 hover:bg-gray-50 text-gray-600 flex items-center gap-1 text-sm font-medium transition-colors">

<Copy size={14} /> Copy

</button>

</div>

</div>

  

{/* TABS */}

<div className="flex border-b border-gray-200 mb-6 justify-between items-center">

<div className="flex gap-6">

<button className="pb-3 text-sm font-medium text-gray-500 hover:text-gray-900">System Setup</button>

<button className="pb-3 text-sm font-medium text-gray-900 border-b-2 border-gray-900">Telemetry & Metrics</button>

</div>

<button className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 mb-3">

<FileText size={16} /> Request logs

</button>

</div>

  

{/* 4x2 METRICS GRID */}

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

<MetricCard

value={`$${budget.current}`}

label="Current Consumption"

timeframe="Last 24h"

/>

<MetricCard

value={`$${budget.projected}`}

label="Projected EOF"

timeframe="OutSystems"

valueColor={budget.projected > budget.cap ? "text-rose-600" : "text-gray-900"}

/>

<MetricCard

value={budget.risk_level}

label="Budget Risk Level"

timeframe="Live Sync"

valueColor={budget.risk_level === 'CRITICAL' ? "text-rose-600" : budget.risk_level === 'HIGH' ? "text-amber-500" : "text-emerald-600"}

/>

<MetricCard

value={`$${budget.cap}`}

label="Total Cap Limit"

timeframe="Monthly"

/>

<MetricCard

value={totalDraw}

label="Current Draw (Watts)"

timeframe="Live"

/>

<MetricCard

value={activeApps}

label="Active Endpoints"

timeframe="Out of 5"

/>

<MetricCard

value={alerts.filter(a => a.status === 'AWAITING_ACK').length}

label="Pending Alerts"

timeframe="Requires Action"

/>

<MetricCard

value="Connected"

label="Orchestration Bus"

timeframe="RabbitMQ"

valueColor="text-emerald-600"

/>

</div>

  

{/* LOWER TWO-COLUMN GRID */}

<div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

{/* LEFT: Endpoint Registry (Like "Request Health") */}

<div className="border border-gray-200 rounded-lg p-6 flex flex-col h-[400px]">

<div className="flex justify-between items-center mb-6">

<h3 className="font-semibold text-gray-900">Endpoint Registry</h3>

<div className="border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-600 flex items-center gap-2 cursor-pointer hover:bg-gray-50">

Past 24 hours <ChevronDown size={14} />

</div>

</div>

<div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">

<div className="space-y-3">

{appliances.map(app => {

const isOn = app.state === 'ON';

return (

<div key={app.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-md bg-gray-50 hover:bg-gray-100 transition-colors">

<div>

<div className="font-medium text-sm text-gray-900">{app.name}</div>

<div className="text-xs text-gray-500 mt-0.5">{app.type} • {app.draw}W</div>

</div>

<button

onClick={() => toggleAppliance(app.id)}

className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${isOn ? 'bg-blue-600' : 'bg-gray-300'}`}

>

<span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${isOn ? 'translate-x-5' : 'translate-x-1'}`} />

</button>

</div>

)

})}

</div>

</div>

{/* Timeline Mock */}

<div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-xs text-gray-400 font-mono">

<span>11:00</span><span>15:00</span><span>19:00</span><span>23:00</span><span>03:00</span><span>07:00</span><span>11:00</span>

</div>

</div>

  

{/* RIGHT: Telemetry & Alerts (Like "Throughput Limited Requests") */}

<div className="border border-gray-200 rounded-lg p-6 flex flex-col h-[400px]">

<div className="flex justify-between items-center mb-6">

<h3 className="font-semibold text-gray-900">Telemetry & Actionable Alerts</h3>

<div className="border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-600 flex items-center gap-2 cursor-pointer hover:bg-gray-50">

Live Feed <ChevronDown size={14} />

</div>

</div>

<div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-3">

{alerts.map((alert) => (

<div key={alert.id} className={`p-4 rounded-md border text-sm flex flex-col gap-2 ${

alert.status === 'AWAITING_ACK' ? 'bg-amber-50 border-amber-200' :

alert.type === 'critical' || alert.status === 'EXCEPTION' ? 'bg-rose-50 border-rose-200' :

alert.type === 'success' ? 'bg-emerald-50 border-emerald-200' :

'bg-white border-gray-200'

}`}>

<div className="flex justify-between items-start">

<span className={`font-medium ${alert.status === 'AWAITING_ACK' ? 'text-amber-900' : 'text-gray-900'}`}>

{alert.message}

</span>

{alert.status === 'AWAITING_ACK' && (

<span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap">

<Clock className="w-3 h-3" /> {alert.ttl}s TTL

</span>

)}

</div>

{alert.status === 'AWAITING_ACK' && (

<div className="flex gap-2 mt-1">

<button onClick={() => handleUserAck(alert.id, alert.targetAppId, 'off')} className="bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-800 text-xs font-medium px-3 py-1.5 rounded transition-colors">

Execute: /off

</button>

<button onClick={() => handleUserAck(alert.id, alert.targetAppId, 'keep')} className="bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-800 text-xs font-medium px-3 py-1.5 rounded transition-colors">

Override: /keep

</button>

</div>

)}

  

{alert.status === 'RESOLVED_AUTO' && (

<div className="text-xs text-amber-700 flex items-center gap-1 font-medium">

<AlertTriangle className="w-3 h-3" /> Auto-cutoff enforced

</div>

)}

{alert.status.startsWith('RESOLVED_USER') && (

<div className="text-xs text-emerald-700 flex items-center gap-1 font-medium">

<CheckCircle2 className="w-3 h-3" /> User Resolved ({alert.status.split('_')[2]})

</div>

)}

</div>

))}

</div>

{/* Timeline Mock */}

<div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-xs text-gray-400 font-mono">

<span>10:40</span><span>10:48</span><span>10:56</span><span>11:04</span><span>11:11</span><span>11:18</span><span>11:25</span><span>11:33</span>

</div>

</div>

  

</div>

  

{/* DAY 26 RECONCILIATION PROTOCOL (Full Width Bottom) */}

<div className="border border-gray-200 rounded-lg bg-white p-6">

<div className="flex justify-between items-center mb-6">

<div>

<h3 className="font-semibold text-gray-900">Day 26 Reconciliation Protocol</h3>

<p className="text-sm text-gray-500 mt-1">Multi-Step Orchestration + Compensation</p>

</div>

{rescueStage === 0 && (

<button onClick={() => runRescueProtocol(1)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm flex items-center gap-2">

<Play size={16}/> Initiate Stage A

</button>

)}

</div>

  

{rescueStage > 0 && (

<div>

{/* Stepper */}

<div className="flex items-center gap-2 text-sm font-medium mb-6">

<div className={`flex-1 py-3 px-4 rounded border ${rescueStage >= 1 ? 'bg-blue-50 border-blue-200 text-blue-800' : 'border-gray-200 text-gray-400 bg-gray-50'}`}>

1. High-Drain Cut

</div>

<ChevronRight className="text-gray-300 w-5 h-5 flex-shrink-0" />

<div className={`flex-1 py-3 px-4 rounded border ${rescueStage >= 2 ? 'bg-blue-50 border-blue-200 text-blue-800' : 'border-gray-200 text-gray-400 bg-gray-50'}`}>

2. Med-Drain Cut

</div>

<ChevronRight className="text-gray-300 w-5 h-5 flex-shrink-0" />

<div className={`flex-1 py-3 px-4 rounded border ${rescueStage >= 3 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'border-gray-200 text-gray-400 bg-gray-50'}`}>

3. Lock & Secure

</div>

</div>

  

<div className="flex gap-4">

{rescueStage === 1 && (

<button onClick={() => runRescueProtocol(2)} className="bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-800 px-4 py-2.5 rounded text-sm font-medium w-full">

Forecast still over ($1060). Execute Stage B

</button>

)}

{rescueStage === 2 && (

<>

<button onClick={() => runRescueProtocol(3)} className="bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-800 px-4 py-2.5 rounded text-sm font-medium w-full">

Forecast tight ($1010). Execute Stage C

</button>

<button onClick={() => runRescueProtocol(4)} className="bg-white border border-rose-200 shadow-sm hover:bg-rose-50 text-rose-700 px-4 py-2.5 rounded text-sm font-medium w-full">

Simulate Timeout (Exception)

</button>

</>

)}

{rescueStage === 3 && (

<div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded text-sm font-medium w-full flex items-center justify-center gap-2">

<CheckCircle2 className="w-5 h-5" /> Budget Secured at $990

</div>

)}

{rescueStage === 4 && (

<div className="bg-rose-50 border border-rose-200 p-4 rounded text-sm w-full flex justify-between items-center">

<div className="flex items-center gap-2 font-medium text-rose-800">

<AlertTriangle className="w-5 h-5" /> Automation Halted. Exception Logged.

</div>

<button className="flex items-center gap-2 bg-white border border-gray-300 shadow-sm hover:bg-gray-50 text-gray-800 px-4 py-2 rounded font-medium transition">

<Download className="w-4 h-4" /> Exception Report

</button>

</div>

)}

</div>

</div>

)}

</div>

  

</div>

</main>

  

{/* STYLES */}

<style dangerouslySetInnerHTML={{__html: `

.custom-scrollbar::-webkit-scrollbar { width: 6px; }

.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }

.custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }

.custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }

`}} />

</div>

);

}

  

// --- SUBCOMPONENTS ---

  

function NavItem({ icon, label, active, hasChevron }) {

return (

<a href="#" className={`flex items-center justify-between px-3 py-2 rounded-md text-[14px] font-medium transition-colors ${

active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

}`}>

<div className="flex items-center gap-3">

{React.cloneElement(icon, { className: active ? 'text-blue-600' : 'text-gray-400' })}

{label}

</div>

{hasChevron && <ChevronDown className="w-4 h-4 text-gray-400" />}

</a>

);

}

  

function MetricCard({ value, label, timeframe, valueColor = "text-gray-900" }) {

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