import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';
import type { SimState, SimConfig } from '../engine/types';
import type { PlayState } from '../hooks/useSimulator';
import { ArrowDown, ArrowUp } from 'lucide-react';

interface ChannelHighwayProps {
  state: SimState;
  config: SimConfig;
  playState: PlayState;
  onDropPacket: (id: string) => void;
}

export const ChannelHighway = React.memo(function ChannelHighway({
  state,
  config: _config,
  playState,
  onDropPacket,
}: ChannelHighwayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [laneDistance, setLaneDistance] = useState<number>(240);

  // Measure channel travel distance for exact pixel translation
  useEffect(() => {
    function updateDistance() {
      if (containerRef.current) {
        const h = containerRef.current.clientHeight;
        setLaneDistance(Math.max(120, h - 78));
      }
    }
    updateDistance();
    window.addEventListener('resize', updateDistance);
    return () => window.removeEventListener('resize', updateDistance);
  }, []);

  const dataPackets = state.activePackets.filter((p) => p.type === 'DATA');
  const ackPackets = state.activePackets.filter((p) => p.type === 'ACK');

  // Derive in-flight counters directly from active non-lost traveling chips
  const activeDataInFlight = dataPackets.filter((p) => !p.isLost).length;
  const activeAckInFlight = ackPackets.filter((p) => !p.isLost).length;

  return (
    <div
      ref={containerRef}
      className="flex-1 relative bg-[#09090b] border-y border-[#27272a] flex overflow-hidden select-none"
      style={{ '--travel-distance': `${laneDistance}px` } as React.CSSProperties}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      {/* OUTBOUND HIGHWAY (DOWNWARD: Sender -> Receiver) */}
      <div className="w-1/2 relative border-r border-[#27272a] flex flex-col justify-between p-3 overflow-hidden">
        {/* Outbound Lane Header */}
        <div className="flex items-center justify-between z-10 bg-[#111114] px-2.5 py-1 rounded-sm border border-[#27272a]">
          <div className="flex items-center gap-1.5 text-zinc-300 font-mono text-[10px] font-semibold uppercase tracking-wider">
            <ArrowDown size={11} className="text-[#38bdf8]" />
            <span>Outbound (Frames ↓)</span>
          </div>
          <span className="text-[9px] font-mono text-zinc-500">
            {activeDataInFlight} in flight
          </span>
        </div>

        {/* Central trajectory guide line */}
        <div className="absolute inset-y-12 left-1/2 w-px border-r border-dashed border-zinc-800/50 pointer-events-none" />

        {/* Hardware-Accelerated Channel Motion Stage (Single-File Vertical Stream) */}
        <div className="absolute inset-x-3 top-10 bottom-3 overflow-hidden">
          {dataPackets.map((pkt) => {
            const lateralShift = ((pkt.seq % 3) - 1) * 20;
            // Earlier dispatched frame leads in front: higher zIndex for leading packets
            const zIndex = 30 + Math.max(0, 100 - (pkt.seq % 100));

            return (
              <div
                key={pkt.id}
                className={cn(
                  'absolute cursor-pointer select-none top-0 left-1/2',
                  pkt.isLost ? 'pkt-travel-down-lost pointer-events-none' : 'pkt-travel-down',
                )}
                style={{
                  '--pkt-x': `${lateralShift}px`,
                  zIndex,
                  willChange: 'transform',
                  animationDuration: `${pkt.durationMs}ms`,
                  animationPlayState: playState === 'playing' ? 'running' : 'paused',
                } as React.CSSProperties}
                onClick={() => onDropPacket(pkt.id)}
                title="Click chip to drop this frame in transit"
              >
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-0.5 rounded-xs border text-[10px] font-mono font-bold transition-all shadow-xs hover:border-rose-500 whitespace-nowrap',
                    pkt.isLost
                      ? 'bg-[#881337] border-[#be123c] text-[#fb7185]'
                      : pkt.isRetransmission
                        ? 'bg-[#451a03] border-[#d97706] text-[#fbbf24]'
                        : 'bg-[#0c4a6e] border-[#38bdf8] text-[#e0f2fe]',
                  )}
                >
                  <span>PKT #{pkt.seq}</span>
                  {pkt.isLost ? (
                    <span className="text-[7px] bg-[#4c0519] text-rose-300 px-1 rounded-2xs border border-rose-800 uppercase font-semibold">
                      LOST
                    </span>
                  ) : pkt.isRetransmission ? (
                    <span className="text-[7px] bg-[#78350f] text-amber-200 px-1 rounded-2xs border border-amber-700 uppercase font-semibold">
                      RETX
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* INBOUND HIGHWAY (UPWARD: Receiver -> Sender ACKs) */}
      <div className="w-1/2 relative flex flex-col justify-between p-3 overflow-hidden">
        {/* Inbound Lane Header */}
        <div className="flex items-center justify-between z-10 bg-[#111114] px-2.5 py-1 rounded-sm border border-[#27272a]">
          <div className="flex items-center gap-1.5 text-zinc-300 font-mono text-[10px] font-semibold uppercase tracking-wider">
            <ArrowUp size={11} className="text-[#34d399]" />
            <span>Inbound (ACKs ↑)</span>
          </div>
          <span className="text-[9px] font-mono text-zinc-500">
            {activeAckInFlight} in flight
          </span>
        </div>

        {/* Central trajectory guide line */}
        <div className="absolute inset-y-12 left-1/2 w-px border-r border-dashed border-zinc-800/50 pointer-events-none" />

        {/* Hardware-Accelerated Channel Motion Stage (Single-File Vertical Stream) */}
        <div className="absolute inset-x-3 top-10 bottom-3 overflow-hidden">
          {ackPackets.map((ack) => {
            const lateralShift = ((ack.seq % 3) - 1) * 16;
            const zIndex = 30 + Math.max(0, 100 - (ack.seq % 100));

            return (
              <div
                key={ack.id}
                className={cn(
                  'absolute cursor-pointer select-none top-0 left-1/2',
                  ack.isLost ? 'ack-travel-up-lost pointer-events-none' : 'ack-travel-up',
                )}
                style={{
                  '--ack-x': `${lateralShift}px`,
                  zIndex,
                  willChange: 'transform',
                  animationDuration: `${ack.durationMs}ms`,
                  animationPlayState: playState === 'playing' ? 'running' : 'paused',
                } as React.CSSProperties}
                onClick={() => onDropPacket(ack.id)}
                title="Click chip to drop this ACK in transit"
              >
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-0.5 rounded-xs border text-[10px] font-mono font-bold transition-all shadow-xs hover:border-rose-500 whitespace-nowrap',
                    ack.isLost
                      ? 'bg-[#881337] border-[#be123c] text-[#fb7185]'
                      : 'bg-[#064e3b] border-[#10b981] text-[#ecfdf5]',
                  )}
                >
                  <span>ACK #{ack.seq}</span>
                  {ack.isLost ? (
                    <span className="text-[7px] bg-[#4c0519] text-rose-300 px-1 rounded-2xs border border-rose-800 uppercase font-semibold">
                      ACK LOST
                    </span>
                  ) : (
                    <span className="text-[7px] bg-[#022c22] text-emerald-400 px-1 rounded-2xs border border-emerald-800/80 uppercase">
                      {ack.isCumulative ? 'CUM' : 'IND'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Idle placeholder */}
      {dataPackets.length === 0 && ackPackets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-30">
          <div className="text-[11px] font-mono text-zinc-500">
            Channel Idle
          </div>
        </div>
      )}
    </div>
  );
});
