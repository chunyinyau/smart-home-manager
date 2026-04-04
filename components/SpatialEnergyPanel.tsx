"use client";

import React, { useMemo, useState } from "react";
import {
  Activity,
  DollarSign,
  Lightbulb,
  Power,
  Server,
  Thermometer,
  TrendingUp,
  Tv,
  Wind,
  Zap,
  Refrigerator,
} from "lucide-react";

import { ApplianceRecord } from "@/lib/types/display.types";

type DeviceIcon = React.ComponentType<{ size?: number; color?: string }>;

type Appliance = {
  id: string; // Layout ID (lights, ac, etc.)
  realId?: string; // DB ID (app_1, etc.)
  name: string;
  room: string;
  icon: DeviceIcon;
  status: "online" | "offline";
  stats: {
    usageKwh: number;
    cost: number;
    hoursActive: number;
    trend: number[];
  };
  nodePos: { cx: number; cy: number };
  linePoints: string;
  hoverBox: string;
};

const APPLIANCES: Appliance[] = [
  {
    id: "lights",
    name: "Pendant Light",
    room: "Bedroom",
    icon: Lightbulb,
    status: "online",
    stats: { usageKwh: 12.5, cost: 3.5, hoursActive: 180, trend: [10, 12, 11, 15, 12, 18, 14] },
    nodePos: { cx: 400, cy: 30 },
    linePoints: "400,100 400,75",
    hoverBox: "340,60 460,60 460,200 340,200",
  },
  {
    id: "thermostat",
    name: "Smart Panel",
    room: "Bedroom",
    icon: Thermometer,
    status: "online",
    stats: { usageKwh: 5.2, cost: 1.45, hoursActive: 720, trend: [5, 5, 5, 6, 5, 5, 5] },
    nodePos: { cx: 80, cy: 220 },
    linePoints: "175,260 80,260",
    hoverBox: "150,230 200,230 200,300 150,300",
  },
  {
    id: "ac",
    name: "Split AC Unit",
    room: "Bedroom",
    icon: Wind,
    status: "offline",
    stats: { usageKwh: 120.4, cost: 33.71, hoursActive: 85, trend: [80, 60, 40, 90, 110, 120, 100] },
    nodePos: { cx: 100, cy: 80 },
    linePoints: "250,140 100,140 100,125",
    hoverBox: "190,100 320,100 320,190 190,190",
  },
  {
    id: "tv",
    name: "OLED Display",
    room: "Bedroom",
    icon: Tv,
    status: "online",
    stats: { usageKwh: 28.0, cost: 7.84, hoursActive: 62, trend: [5, 10, 8, 25, 30, 20, 28] },
    nodePos: { cx: 720, cy: 230 },
    linePoints: "560,230 720,230",
    hoverBox: "480,160 620,160 620,330 480,330",
  },
  {
    id: "fridge",
    name: "Kitchen Fridge",
    room: "Kitchen",
    icon: Refrigerator,
    status: "online",
    stats: { usageKwh: 45.0, cost: 12.02, hoursActive: 720, trend: [45, 46, 44, 45, 45, 44, 45] },
    nodePos: { cx: 750, cy: 120 },
    linePoints: "630,250 750,120",
    hoverBox: "600,220 690,220 690,420 600,420",
  },
];

const DEVICE_MATCHERS: Record<string, RegExp[]> = {
  lights: [/lamp/i, /light/i],
  thermostat: [/smart\s*panel/i, /panel/i],
  ac: [/air\s*con/i, /ac/i, /air\s*conditioning/i],
  tv: [/\btv\b/i, /display/i],
  fridge: [/fridge/i, /refrigerator/i],
};

const SPEND_TREND_FACTORS = [0.76, 0.82, 0.88, 0.93, 0.96, 0.99, 1.0];
const COST_PER_KWH_SGD = 0.2671;

function buildSpendTrend(cost: number, currentWatts: number, isOnline: boolean) {
  const activityBoost = Math.min((Math.max(0, currentWatts) / 1500) * 0.12, 0.12);
  const offlinePenalty = isOnline ? 0 : -0.08;

  const trend = SPEND_TREND_FACTORS.map((base, index) => {
    const dayTilt = ((index - 3) / 3) * activityBoost;
    const factor = Math.max(0.55, base + dayTilt + offlinePenalty);
    return Number((cost * factor).toFixed(3));
  });

  // Keep the latest point exactly in sync with current device spend.
  trend[trend.length - 1] = Number(cost.toFixed(3));
  return trend;
}

function Sparkline({ data, colorClass }: { data: number[]; colorClass: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 100 - (((value - min) / range) * 72 + 14);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="relative mt-3 h-20 overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkFill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,100 ${points} 100,100`} fill="url(#sparkFill)" className={colorClass} />
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={colorClass} />
      </svg>
    </div>
  );
}

interface SpatialEnergyPanelProps {
  appliances?: ApplianceRecord[] | null;
}

export default function SpatialEnergyPanel({ appliances: liveAppliances }: SpatialEnergyPanelProps) {
  // Map live data to layout
  const mappedAppliances = useMemo(() => {
    if (!liveAppliances || liveAppliances.length === 0) return APPLIANCES;

    return APPLIANCES.map((layoutApp) => {
      const matchers = DEVICE_MATCHERS[layoutApp.id] ?? [];
      const liveApp = liveAppliances.find((a) =>
        matchers.some((matcher) => matcher.test(a.name)),
      );

      if (!liveApp) return layoutApp;

      const sliceKwh = (Math.max(0, Number(liveApp.currentWatts) || 0) * (5 / 60)) / 1000;
      const usageKwh = Math.max(Number(liveApp.kwhUsed) || 0, sliceKwh);
      const cost = usageKwh * COST_PER_KWH_SGD;
      const trend = buildSpendTrend(cost, Number(liveApp.currentWatts) || 0, liveApp.state === "ON");

      return {
        ...layoutApp,
        realId: liveApp.id,
        name: liveApp.name,
        room: liveApp.room,
        status: liveApp.state === "ON" ? "online" : "offline",
        stats: {
          ...layoutApp.stats,
          usageKwh,
          cost,
          hoursActive: liveApp.state === "ON" ? Math.max(1, Math.round(usageKwh * 24)) : 0,
          trend,
        },
      };
    });
  }, [liveAppliances]);

  const applianceById = useMemo(
    () => Object.fromEntries(mappedAppliances.map((appliance) => [appliance.id, appliance])),
    [mappedAppliances],
  );

  const [activeApplianceId, setActiveApplianceId] = useState<string>(mappedAppliances[0].id);
  const [hoveredApplianceId, setHoveredApplianceId] = useState<string | null>(null);

  const activeAppliance = useMemo(
    () => mappedAppliances.find((appliance) => appliance.id === activeApplianceId) ?? mappedAppliances[0],
    [activeApplianceId, mappedAppliances],
  );

  const totals = useMemo(
    () =>
      mappedAppliances.reduce(
        (acc, appliance) => ({
          energyKwh: acc.energyKwh + appliance.stats.usageKwh,
          cost: acc.cost + appliance.stats.cost,
        }),
        { energyKwh: 0, cost: 0 },
      ),
    [mappedAppliances],
  );

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <article className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Activity className="h-5 w-5 text-gray-500" />
            Spatial Layout
          </h2>
          <p className="text-xs text-gray-500">Hover appliances to inspect, click to pin</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-[#f8f9fa]">
          <svg viewBox="0 0 800 600" className="h-auto w-full">
            <defs>
              <linearGradient id="layoutTvScreen" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0f172a" />
                <stop offset="100%" stopColor="#1e293b" />
              </linearGradient>
              <linearGradient id="layoutTvContent" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.1" />
              </linearGradient>
              <linearGradient id="layoutLightBeam" x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="#fef08a" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#fef08a" stopOpacity="0" />
              </linearGradient>
              <filter id="layoutActiveGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ef4444" floodOpacity="0.75" />
              </filter>
            </defs>

            <g id="Room-Structure">
              <polygon points="400,550 100,400 400,250 700,400" fill="#e2d5c3" stroke="#d1c0a8" strokeWidth="2" />
              <g stroke="#d1c0a8" strokeWidth="1" opacity="0.5">
                <line x1="150" y1="425" x2="450" y2="275" />
                <line x1="200" y1="450" x2="500" y2="300" />
                <line x1="250" y1="475" x2="550" y2="325" />
                <line x1="300" y1="500" x2="600" y2="350" />
                <line x1="350" y1="525" x2="650" y2="375" />
              </g>

              <polygon points="100,400 400,250 400,50 100,200" fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="2" />
              <polygon points="400,250 700,400 700,200 400,50" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="2" />

              <g>
                <polygon points="440,210 610,295 610,165 440,80" fill="#ffffff" />
                <polygon points="450,220 600,295 600,165 450,90" fill="#bae6fd" opacity="0.7" />
                <line x1="525" y1="127.5" x2="525" y2="257.5" stroke="#ffffff" strokeWidth="6" />
                <line x1="450" y1="155" x2="600" y2="230" stroke="#ffffff" strokeWidth="6" />
                <polygon points="440,210 610,295 610,165 440,80" fill="none" stroke="#cbd5e1" strokeWidth="2" />
              </g>

              <g>
                <polygon points="260,190 330,155 330,115 260,150" fill="#ffffff" stroke="#94a3b8" strokeWidth="2" />
                <polygon points="265,185 325,155 325,120 265,150" fill="#cbd5e1" />
                <circle cx="295" cy="152" r="8" fill="#f87171" opacity="0.8" />
              </g>

              <g>
                <polygon points="400,280 380,265 400,255 420,265" fill="#475569" />
                <polygon points="380,265 400,280 400,310 380,295" fill="#334155" />
                <polygon points="400,280 420,265 420,295 400,310" fill="#1e293b" />
                <circle cx="400" cy="245" r="15" fill="#22c55e" opacity="0.9" />
                <circle cx="385" cy="255" r="12" fill="#16a34a" opacity="0.9" />
                <circle cx="415" cy="255" r="12" fill="#15803d" opacity="0.9" />
              </g>

              <polygon points="400,500 230,415 400,330 570,415" fill="#94a3b8" opacity="0.4" />
              <polygon points="400,485 245,415 400,345 555,415" fill="none" stroke="#f8fafc" strokeWidth="2" opacity="0.6" />

              <g>
                <polygon points="350,290 460,345 460,285 350,230" fill="#334155" />
                <polygon points="340,295 350,290 350,230 340,235" fill="#1e293b" />
                <polygon points="350,420 460,365 460,345 350,400" fill="#64748b" />
                <polygon points="240,365 350,420 350,400 240,345" fill="#475569" />
                <polygon points="350,400 240,345 350,290 460,345" fill="#94a3b8" />
                <polygon points="350,390 450,340 450,320 350,370" fill="#f8fafc" />
                <polygon points="250,340 350,390 350,370 250,320" fill="#e2e8f0" />
                <polygon points="350,370 250,320 350,270 450,320" fill="#ffffff" />
                <polygon points="350,375 280,340 350,305 452,356" fill="#6366f1" opacity="0.9" />
                <polygon points="350,375 452,324 452,344 350,395" fill="#4f46e5" />
                <polygon points="280,340 350,375 350,395 280,360" fill="#4338ca" />
                <polygon points="310,295 340,310 360,300 330,285" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
                <polygon points="340,280 370,295 390,285 360,270" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
              </g>

              <g>
                <polygon points="500,360 600,410 630,395 530,345" fill="#d4a373" />
                <polygon points="500,360 600,410 600,430 500,380" fill="#a67c52" />
                <polygon points="600,410 630,395 630,415 600,430" fill="#8b5a2b" />
                <line x1="550" y1="385" x2="550" y2="405" stroke="#784a23" strokeWidth="2" />
              </g>

              <g>
                <polygon points="440,420 490,445 520,430 470,405" fill="#f1f5f9" />
                <polygon points="440,420 490,445 490,480 440,455" fill="#cbd5e1" />
                <polygon points="490,445 520,430 520,465 490,480" fill="#94a3b8" />
                <polygon points="445,430 485,450 485,465 445,445" fill="#94a3b8" />
              </g>
            </g>

            <g filter={activeApplianceId === "thermostat" ? "url(#layoutActiveGlow)" : undefined} className="transition-all duration-300">
              <polygon points="170,255 190,245 190,275 170,285" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1" />
              <polygon points="172,257 188,249 188,273 172,281" fill="#0f172a" />
              <line x1="176" y1="265" x2="184" y2="261" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="180" cy="272" r="1.5" fill="#10b981" />
            </g>

            <g filter={activeApplianceId === "ac" ? "url(#layoutActiveGlow)" : undefined} className="transition-all duration-300">
              <polygon points="190,170 300,115 300,145 190,200" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
              <polygon points="300,115 315,122.5 315,152.5 300,145" fill="#e2e8f0" />
              <polygon points="190,200 300,145 315,152.5 205,207.5" fill="#f8fafc" />
              <line x1="200" y1="195" x2="300" y2="145" stroke="#94a3b8" strokeWidth="1.5" />
              <line x1="205" y1="200" x2="305" y2="150" stroke="#94a3b8" strokeWidth="1.5" />
              <circle cx="285" cy="138" r="3" fill="#ef4444" />
              <rect x="200" y="175" width="10" height="4" fill="#cbd5e1" transform="rotate(-26.5 200 175)" />
            </g>

            <g filter={activeApplianceId === "tv" ? "url(#layoutActiveGlow)" : undefined} className="transition-all duration-300">
              <polygon points="490,280 600,335 600,245 490,190" fill="url(#layoutTvScreen)" stroke="#020617" strokeWidth="3" />
              <polygon points="485,280 490,280 490,190 485,190" fill="#1e293b" />
              {applianceById.tv?.status === "online" && (
                <g>
                  <polygon points="493,278 597,330 597,248 493,196" fill="url(#layoutTvContent)" />
                  <polygon points="510,240 540,255 540,225 510,210" fill="#38bdf8" opacity="0.5" />
                  <line x1="550" y1="280" x2="580" y2="295" stroke="#ffffff" strokeWidth="2" opacity="0.6" />
                  <line x1="550" y1="270" x2="570" y2="280" stroke="#ffffff" strokeWidth="2" opacity="0.6" />
                </g>
              )}
            </g>

            <g filter={activeApplianceId === "lights" ? "url(#layoutActiveGlow)" : undefined} className="transition-all duration-300">
              {applianceById.lights?.status === "online" && (
                <polygon points="380,130 420,130 500,400 300,400" fill="url(#layoutLightBeam)" pointerEvents="none" />
              )}
              <line x1="400" y1="0" x2="400" y2="100" stroke="#475569" strokeWidth="2" />
              <ellipse cx="400" cy="100" rx="30" ry="15" fill="#1e293b" stroke="#0f172a" strokeWidth="1" />
              <ellipse cx="400" cy="98" rx="30" ry="15" fill="#334155" />
              <ellipse cx="400" cy="105" rx="20" ry="10" fill="#f8fafc" />
              {applianceById.lights?.status === "online" && (
                <ellipse cx="400" cy="110" rx="15" ry="8" fill="#fef08a" style={{ filter: "blur(3px)" }} />
              )}
            </g>

            <g filter={activeApplianceId === "fridge" ? "url(#layoutActiveGlow)" : undefined} className="transition-all duration-300">
              <polygon points="640,230 680,250 650,265 610,245" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
              <polygon points="640,370 610,385 610,245 640,230" fill="#94a3b8" />
              <polygon points="610,385 650,405 650,265 610,245" fill="#cbd5e1" />
              <line x1="610" y1="315" x2="650" y2="335" stroke="#94a3b8" strokeWidth="2" />
              <line x1="640" y1="270" x2="640" y2="300" stroke="#f1f5f9" strokeWidth="2.5" strokeLinecap="round" />
            </g>

            <g id="Interactive-Hitboxes" fill="transparent" className="cursor-pointer">
              {mappedAppliances.map((appliance) => (
                <polygon
                  key={`hitbox-${appliance.id}`}
                  points={appliance.hoverBox}
                  onMouseEnter={() => setHoveredApplianceId(appliance.id)}
                  onMouseLeave={() => setHoveredApplianceId(null)}
                  onClick={() => setActiveApplianceId(appliance.id)}
                />
              ))}
            </g>

            {mappedAppliances.map((appliance) => {
              const isHovered = hoveredApplianceId === appliance.id;
              const Icon = appliance.icon;
              return (
                <g
                  key={`node-${appliance.id}`}
                  className={`pointer-events-none transition-all duration-300 ${
                    isHovered ? "opacity-100 scale-100" : "opacity-0 scale-95"
                  }`}
                  style={{ transformOrigin: `${appliance.nodePos.cx}px ${appliance.nodePos.cy}px` }}
                >
                  <polyline points={appliance.linePoints} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
                  <circle
                    cx={appliance.nodePos.cx}
                    cy={appliance.nodePos.cy}
                    r="36"
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="2"
                    className={isHovered ? "animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" : undefined}
                  />
                  <circle cx={appliance.nodePos.cx} cy={appliance.nodePos.cy} r="28" fill="#ef4444" style={{ filter: "drop-shadow(0px 8px 12px rgba(239,68,68,0.4))" }} />
                  <g transform={`translate(${appliance.nodePos.cx - 12}, ${appliance.nodePos.cy - 12})`}>
                    <Icon color="white" size={24} />
                  </g>
                  <rect x={appliance.nodePos.cx - 60} y={appliance.nodePos.cy + 38} width="120" height="26" rx="6" fill="#0f172a" style={{ filter: "drop-shadow(0px 4px 6px rgba(0,0,0,0.25))" }} />
                  <text x={appliance.nodePos.cx} y={appliance.nodePos.cy + 55} fill="white" fontSize="13" fontWeight={600} textAnchor="middle">
                    {appliance.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </article>

      <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
          <Server className="h-5 w-5 text-gray-500" />
          Energy & Cost
        </h3>

        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{activeAppliance.room}</p>
            <p className="text-xl font-semibold text-gray-900">{activeAppliance.name}</p>
          </div>
          <div
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
              activeAppliance.status === "online"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-gray-300 bg-gray-100 text-gray-600"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {activeAppliance.status.toUpperCase()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
              <Zap className="h-3.5 w-3.5" />
              Device Energy
            </div>
            <div className="text-xl font-semibold text-gray-900">
              {activeAppliance.stats.usageKwh.toFixed(1)} <span className="text-sm font-normal text-gray-500">kWh</span>
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
              <DollarSign className="h-3.5 w-3.5" />
              Device Cost
            </div>
            <div className="text-xl font-semibold text-gray-900">${activeAppliance.stats.cost.toFixed(2)}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-3.5">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Total Energy</p>
            <p className="text-base font-semibold text-gray-900">{activeAppliance.stats.usageKwh.toFixed(1)} kWh</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-500">Total Cost</p>
            <p className="text-base font-semibold text-gray-900">${totals.cost.toFixed(2)}</p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-gray-500">
              <TrendingUp className="h-4 w-4" />
              7-Day Device Trend
            </span>
            <span className="text-gray-500">{activeAppliance.stats.hoursActive} hrs active</span>
          </div>
          <Sparkline data={activeAppliance.stats.trend} colorClass={activeAppliance.status === "online" ? "text-red-500" : "text-gray-500"} />
        </div>
      </article>
    </section>
  );
}
