import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import type { SimState, SimConfig, LogEntry } from '../engine/types';
import { Terminal, Zap, ZapOff, Activity } from 'lucide-react';

interface DiagnosticsPanelProps {
  state: SimState;
  config: SimConfig;
  pendingDropFrame: boolean;
  pendingDropAck: boolean;
  onToggleDropFrame: () => void;
  onToggleDropAck: () => void;
}

const TAG_STYLES: Record<string, { color: string; bg: string }> = {
  TX: { color: 'text-sky-300', bg: 'bg-sky-950/80 border-sky-800' },
  RX: { color: 'text-zinc-300', bg: 'bg-zinc-800/80 border-zinc-700' },
  ACK_TX: { color: 'text-teal-300', bg: 'bg-teal-950/80 border-teal-800' },
  ACK_RX: { color: 'text-emerald-300', bg: 'bg-emerald-950/80 border-emerald-800' },
  DROP: { color: 'text-rose-300', bg: 'bg-rose-950/80 border-rose-800' },
  TIMEOUT: { color: 'text-amber-300', bg: 'bg-amber-950/80 border-amber-800' },
  SLIDE: { color: 'text-blue-300', bg: 'bg-blue-950/80 border-blue-800' },
  DELIVER: { color: 'text-emerald-400', bg: 'bg-emerald-950/90 border-emerald-700' },
  BUFFER: { color: 'text-amber-400', bg: 'bg-amber-950/90 border-amber-700' },
  RETX: { color: 'text-amber-300', bg: 'bg-amber-950/80 border-amber-800' },
};

export const DiagnosticsPanel = React.memo(function DiagnosticsPanel({
  state,
  config,
  pendingDropFrame,
  pendingDropAck,
  onToggleDropFrame,
  onToggleDropAck,
}: DiagnosticsPanelProps) {
  const [filterTag, setFilterTag] = useState<string>('ALL');

  // Cap displayed logs to the most recent 50 entries to prevent DOM bloat and panel freezing
  const recentLogs = state.log.slice(-50);
  const filteredLogs =
    filterTag === 'ALL'
      ? recentLogs
      : recentLogs.filter((entry) => entry.tag === filterTag);

  return (
    <aside className="w-full h-full bg-[#0c0c0e] border-t lg:border-t-0 lg:border-l border-[#27272a] flex flex-col overflow-hidden select-none font-mono">
      
      {/* Layout shifts to side-by-side or stacked grid depending on breakpoint */}
      <div className="flex flex-col md:flex-row lg:flex-col border-b border-[#27272a] bg-[#09090b]">
        
        {/* Telemetry Strip - Scales cleanly inside container boundaries */}
        <div className="flex-1 border-b md:border-b-0 md:border-r lg:border-r-0 lg:border-b border-[#27272a]">
          <TelemetryHUD
            totalSent={state.totalSent}
            totalDelivered={state.totalDelivered}
            totalRetransmissions={state.totalRetransmissions}
            totalPackets={config.totalPackets}
            protocol={config.protocol}
            windowSize={config.windowSize}
            simTime={state.simTime}
            timeoutDuration={config.timeoutDuration}
            isComplete={state.isComplete}
          />
        </div>

        {/* Manual Fault Injections Section */}
        <div className="p-2.5 flex-1 flex flex-col justify-center">
          <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">
            Manual Fault Injections
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={onToggleDropFrame}
              className={cn(
                'flex items-center justify-center gap-1.5 px-2 py-2 rounded-xs border text-[10px] font-mono transition-colors cursor-pointer',
                pendingDropFrame
                  ? 'bg-[#881337] border-[#be123c] text-white font-bold'
                  : 'bg-[#18181b] border-[#27272a] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700',
              )}
            >
              {pendingDropFrame ? <ZapOff size={10} /> : <Zap size={10} />}
              <span>Drop Next Frame</span>
            </button>

            <button
              onClick={onToggleDropAck}
              className={cn(
                'flex items-center justify-center gap-1.5 px-2 py-2 rounded-xs border text-[10px] font-mono transition-colors cursor-pointer',
                pendingDropAck
                  ? 'bg-[#881337] border-[#be123c] text-white font-bold'
                  : 'bg-[#18181b] border-[#27272a] text-zinc-400 hover:text-zinc-200 hover:border-zinc-700',
              )}
            >
              {pendingDropAck ? <ZapOff size={10} /> : <Zap size={10} />}
              <span>Drop Next ACK</span>
            </button>
          </div>
        </div>
      </div>

      {/* Log Stream Section Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#27272a] bg-[#111114]">
        <div className="flex items-center gap-1.5 text-zinc-400 text-[10px] font-bold uppercase tracking-wider">
          <Terminal size={11} />
          <span>Protocol Event Log</span>
        </div>

        <div className="flex items-center gap-1">
          {['ALL', 'DROP', 'TIMEOUT', 'RETX'].map((t) => (
            <button
              key={t}
              onClick={() => setFilterTag(t)}
              className={cn(
                'px-1.5 py-0.5 rounded-xs text-[8px] uppercase transition-colors',
                filterTag === t
                  ? 'bg-[#27272a] text-white font-bold border border-[#3f3f46]'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Event Log Window - Given a safe baseline height for mobile touch scrolling */}
      <div className="flex-1 min-h-[200px] lg:min-h-0 flex flex-col overflow-hidden">
        <EventLog entries={filteredLogs} />
      </div>
    </aside>
  );
});

interface TelemetryHUDProps {
  totalSent: number;
  totalDelivered: number;
  totalRetransmissions: number;
  totalPackets: number;
  protocol: string;
  windowSize: number;
  simTime: number;
  timeoutDuration: number;
  isComplete: boolean;
}

const TelemetryHUD = React.memo(function TelemetryHUD({
  totalSent,
  totalDelivered,
  totalRetransmissions,
  totalPackets,
  protocol,
  windowSize,
  simTime,
  timeoutDuration,
  isComplete,
}: TelemetryHUDProps) {
  const efficiency =
    totalSent > 0
      ? ((totalDelivered / totalSent) * 100).toFixed(1)
      : '100.0';

  return (
    <div className="p-3 border-b border-[#27272a] bg-[#09090b]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-zinc-300 text-[10px] font-bold uppercase tracking-wider">
          <Activity size={12} className="text-[#3b82f6]" />
          <span>Telemetry Strip</span>
        </div>
        <span className="text-[9px] text-zinc-500 bg-[#18181b] px-1.5 py-0.5 rounded-xs border border-[#27272a]">
          {protocol.toUpperCase()} / N={windowSize}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <MetricBlock label="Total Sent" value={totalSent} sub={`${totalRetransmissions} retx`} />
        <MetricBlock label="Delivered" value={totalDelivered} sub={`of ${totalPackets} total`} accent="emerald" />
        <MetricBlock label="Retransmissions" value={totalRetransmissions} sub={protocol === 'gbn' ? 'Go-Back-All' : 'Selective'} accent="amber" />
        <MetricBlock label="Efficiency %" value={`${efficiency}%`} sub="Delivered / Sent" accent="blue" />
      </div>

      {/* Live Status Row */}
      <div className="mt-2 flex items-center justify-between text-[10px] bg-[#18181b] px-2 py-1 rounded-xs border border-[#27272a] text-zinc-400">
        <div>
          Clock: <span className="text-zinc-200 font-bold">{simTime.toFixed(2)}s</span>
        </div>
        <div>
          Timeout: <span className="text-zinc-200 font-bold">{timeoutDuration}s</span>
        </div>
        {isComplete && (
          <span className="text-[#34d399] font-bold">
            ✓ COMPLETED
          </span>
        )}
      </div>
    </div>
  );
});

function MetricBlock({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub: string;
  accent?: 'emerald' | 'amber' | 'blue';
}) {
  const accentText = {
    emerald: 'text-[#34d399]',
    amber: 'text-[#fbbf24]',
    blue: 'text-[#38bdf8]',
  };

  return (
    <div className="bg-[#18181b] rounded-xs border border-[#27272a] p-2 flex flex-col justify-between">
      <div className="text-[8px] uppercase tracking-wider text-zinc-500 font-semibold truncate">
        {label}
      </div>
      <div
        className={cn(
          'text-sm font-bold my-0.5 tabular-nums',
          accent ? accentText[accent] : 'text-zinc-200',
        )}
      >
        {value}
      </div>
      <div className="text-[8px] text-zinc-500 truncate">
        {sub}
      </div>
    </div>
  );
}

const EventLog = React.memo(function EventLog({ entries }: { entries: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the log container strictly keyed on entries.length
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-2.5 space-y-1 text-[10px] leading-tight"
    >
      {entries.length === 0 && (
        <div className="text-zinc-600 text-center py-8">
          Awaiting protocol activity...
        </div>
      )}

      {entries.map((entry) => {
        const style = TAG_STYLES[entry.tag] ?? {
          color: 'text-zinc-400',
          bg: 'bg-zinc-900 border-zinc-800',
        };

        return (
          <div
            key={entry.id}
            className="flex items-start gap-1.5 p-0.5 rounded-xs hover:bg-[#18181b]/50 transition-colors"
          >
            <span className="text-zinc-600 tabular-nums flex-shrink-0 w-11 text-right">
              {entry.time.toFixed(2)}s
            </span>
            <span
              className={cn(
                'flex-shrink-0 px-1 py-0.2 rounded-xs border text-[8px] uppercase font-bold tracking-tight',
                style.bg,
                style.color,
              )}
            >
              {entry.tag}
            </span>
            <span className="text-zinc-300 break-words flex-1">
              {entry.message}
            </span>
          </div>
        );
      })}
    </div>
  );
});
