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
  config,
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
        setLaneDistance(Math.max(140, h - 36));
      }
    }
    updateDistance();
    window.addEventListener('resize', updateDistance);
    return () => window.removeEventListener('resize', updateDistance);
  }, []);

  const dataPackets = state.activePackets.filter((p) => p.type === 'DATA');
  const ackPackets = state.activePackets.filter((p) => p.type === 'ACK');

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
            {dataPackets.length} in flight
          </span>
        </div>

        {/* Hardware-Accelerated Channel Motion Stage */}
        <div className="absolute inset-x-3 top-10 bottom-3 overflow-hidden">
          {dataPackets.map((pkt) => {
            const slotIndex = pkt.seq % Math.max(config.windowSize, 4);
            const leftPercent = 12 + slotIndex * (76 / Math.max(config.windowSize, 4));

            return (
              <div
                key={pkt.id}
                className={cn(
                  'absolute z-20 cursor-pointer select-none',
                  pkt.isLost
                    ? 'scale-90 opacity-0 transition-all duration-300 pointer-events-none'
                    : 'pkt-travel-down',
                )}
                style={{
                  left: `${leftPercent}%`,
                  willChange: 'transform',
                  animationDuration: `${pkt.durationMs}ms`,
                  animationPlayState: playState === 'playing' ? 'running' : 'paused',
                }}
                onClick={() => onDropPacket(pkt.id)}
                title="Click chip to drop this frame in transit"
              >
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-xs border text-[10px] font-mono font-bold transition-all shadow-xs hover:border-rose-500',
                    pkt.isLost
                      ? 'bg-[#881337] border-[#be123c] text-[#fb7185] line-through'
                      : pkt.isRetransmission
                        ? 'bg-[#451a03] border-[#d97706] text-[#fbbf24]'
                        : 'bg-[#0c4a6e] border-[#38bdf8] text-[#e0f2fe]',
                  )}
                >
                  <span>PKT {pkt.seq}</span>
                  {pkt.isRetransmission && !pkt.isLost && (
                    <span className="text-[7px] bg-[#78350f] text-amber-200 px-0.5 rounded-xs">
                      R
                    </span>
                  )}
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
            {ackPackets.length} in flight
          </span>
        </div>

        {/* Hardware-Accelerated Channel Motion Stage */}
        <div className="absolute inset-x-3 top-10 bottom-3 overflow-hidden">
          {ackPackets.map((ack) => {
            const slotIndex = ack.seq % Math.max(config.windowSize, 4);
            const leftPercent = 12 + slotIndex * (76 / Math.max(config.windowSize, 4));

            return (
              <div
                key={ack.id}
                className={cn(
                  'absolute z-20 cursor-pointer select-none',
                  ack.isLost
                    ? 'scale-90 opacity-0 transition-all duration-300 pointer-events-none'
                    : 'ack-travel-up',
                )}
                style={{
                  left: `${leftPercent}%`,
                  willChange: 'transform',
                  animationDuration: `${ack.durationMs}ms`,
                  animationPlayState: playState === 'playing' ? 'running' : 'paused',
                }}
                onClick={() => onDropPacket(ack.id)}
                title="Click chip to drop this ACK in transit"
              >
                <div
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-xs border text-[10px] font-mono font-bold transition-all shadow-xs hover:border-rose-500',
                    ack.isLost
                      ? 'bg-[#881337] border-[#be123c] text-[#fb7185] line-through'
                      : 'bg-[#064e3b] border-[#059669] text-[#a7f3d0]',
                  )}
                >
                  <span>ACK {ack.seq}</span>
                  <span className="text-[7px] text-zinc-400 font-normal uppercase">
                    {ack.isCumulative ? 'C' : 'S'}
                  </span>
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
