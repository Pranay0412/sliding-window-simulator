import React from 'react';
import { cn } from '../lib/utils';
import type { SimConfig, SimState, FrameStatus } from '../engine/types';

interface SenderLaneProps {
  state: SimState;
  config: SimConfig;
}

const BOX_WIDTH = 38;
const BOX_HEIGHT = 42;
const GAP = 6;
const STEP = BOX_WIDTH + GAP; // 44px

export const SenderLane = React.memo(function SenderLane({ state, config }: SenderLaneProps) {
  const windowWidth = config.windowSize * STEP - GAP;
  const isGbn = config.protocol === 'gbn';

  return (
    <div className="bg-[#09090b] border-b border-[#27272a] px-4 py-2.5 flex-shrink-0 select-none">
      {/* Telemetry and metadata subheader */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-300">
            Sender Buffer
          </span>
          <span className="text-[10px] font-mono text-zinc-500 bg-[#18181b] px-1.5 py-0.5 rounded-xs border border-[#27272a]">
            Base: <strong className="text-zinc-200">#{state.senderBase}</strong> · Next: <strong className="text-zinc-200">#{state.nextSeqNum}</strong> · Window N={config.windowSize}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#18181b] border border-[#27272a]" />
            <span>Unsent</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#0c4a6e] border border-[#38bdf8]" />
            <span className="text-sky-400">In-Flight</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#065f46] border border-[#059669]" />
            <span className="text-emerald-400">ACKed</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#881337] border border-[#be123c]" />
            <span className="text-rose-400">Lost</span>
          </div>
        </div>
      </div>

      {/* Static Horizontal Rail with Floating Active Window Bracket Overlay */}
      <div className="relative overflow-x-auto py-2">
        <div
          className="relative flex items-center"
          style={{
            width: `${config.totalPackets * STEP + 20}px`,
            height: `${BOX_HEIGHT + 14}px`,
          }}
        >
          {/* FLOATING ACTIVE WINDOW BRACKET */}
          <div
            className="absolute top-2 rounded-xs border-2 border-[#3b82f6] pointer-events-none z-10 transition-transform"
            style={{
              width: `${windowWidth}px`,
              height: `${BOX_HEIGHT}px`,
              transform: `translateX(${state.senderBase * STEP}px)`,
              transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              backgroundColor: 'rgba(59, 130, 246, 0.08)',
            }}
          >
            {/* Sliding Bracket Tag */}
            <div className="absolute -top-3 left-0 text-[8px] font-mono font-bold text-[#3b82f6] whitespace-nowrap bg-[#09090b] px-1 rounded-xs border border-[#3b82f6]/40">
              WINDOW [{state.senderBase} .. {Math.min(state.senderBase + config.windowSize - 1, config.totalPackets - 1)}]
            </div>
          </div>

          {/* STATIC HORIZONTAL RAIL OF NUMBERED BOXES */}
          <div className="absolute top-2 flex items-center gap-[6px]">
            {Array.from({ length: config.totalPackets }, (_, i) => {
              const slot = state.senderSlots.get(i);
              const status: FrameStatus = slot?.status ?? 'unsent';
              const isBase = i === state.senderBase;
              const isTimeout = status === 'timeout' || (slot?.timeoutFlashUntil !== null && (slot?.timeoutFlashUntil ?? 0) > Date.now());

              let style = 'bg-[#18181b] border-[#27272a] text-[#71717a]';
              if (isTimeout) {
                style = 'bg-[#881337] border-[#f59e0b] text-[#fbbf24] animate-pulse';
              } else if (status === 'acked') {
                style = 'bg-[#065f46] border-[#059669] text-[#34d399]';
              } else if (status === 'in-flight') {
                style = 'bg-[#0c4a6e]/40 border-[#38bdf8] text-[#38bdf8]';
              } else if (status === 'dropped') {
                style = 'bg-[#881337]/40 border-[#be123c] text-[#fb7185]';
              }

              const timeoutMs = Math.round((config.timeoutDuration * 1000) / config.animationSpeed);
              const showGbnTimer = isGbn && isBase && state.gbnTimerStart !== null && status !== 'acked';
              const showSrTimer = !isGbn && status === 'in-flight' && slot?.timerStart !== null;

              return (
                <div
                  key={`sender-box-${i}`}
                  className={cn(
                    'rounded-xs border flex flex-col items-center justify-between p-1 relative overflow-hidden transition-colors',
                    style,
                  )}
                  style={{
                    width: `${BOX_WIDTH}px`,
                    height: `${BOX_HEIGHT}px`,
                  }}
                >
                  <div className="text-[10px] font-mono font-bold leading-none">
                    #{i}
                  </div>

                  <div className="text-[7px] font-mono uppercase tracking-tight truncate">
                    {isTimeout ? 'TIMEOUT' : status === 'acked' ? 'ACK' : status === 'in-flight' ? 'SENT' : status === 'dropped' ? 'LOST' : 'WAIT'}
                  </div>

                  {/* Embedded micro-timer countdown bar (drains 100% -> 0% over timeout) */}
                  {(showGbnTimer || showSrTimer) && (
                    <div className="absolute inset-x-0 bottom-0 h-[2.5px] bg-black/50 overflow-hidden">
                      <div
                        key={`timer-drain-${i}-${isGbn ? state.gbnTimerStart : slot?.timerStart}`}
                        className="h-full bg-[#f59e0b] timer-bar-drain"
                        style={{
                          animationDuration: `${timeoutMs}ms`,
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
