import React from 'react';
import { cn } from '../lib/utils';
import type { SimConfig, SimState, ReceiverSlotState } from '../engine/types';

interface ReceiverLaneProps {
  state: SimState;
  config: SimConfig;
}

const BOX_WIDTH = 38;
const BOX_HEIGHT = 42;
const GAP = 6;
const STEP = BOX_WIDTH + GAP; // 44px

export const ReceiverLane = React.memo(function ReceiverLane({ state, config }: ReceiverLaneProps) {
  const isGbn = config.protocol === 'gbn';
  const bracketWidth = isGbn ? BOX_WIDTH : config.windowSize * STEP - GAP;

  return (
    <div className="bg-[#09090b] border-t border-[#27272a] px-4 py-2.5 flex-shrink-0 select-none">
      {/* Subheader */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-zinc-300">
            Receiver Buffer
          </span>
          <span className="text-[10px] font-mono text-zinc-500 bg-[#18181b] px-1.5 py-0.5 rounded-xs border border-[#27272a]">
            {isGbn
              ? `Expecting: #${state.receiverBase} (Wr=1)`
              : `Base: #${state.receiverBase} · Window Wr=${config.windowSize}`}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#18181b] border border-[#27272a]" />
            <span>Empty</span>
          </div>
          {!isGbn && (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-xs bg-[#78350f] border border-[#d97706]" />
              <span className="text-amber-400">Buffered</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-xs bg-[#065f46] border border-[#059669]" />
            <span className="text-emerald-400">Delivered ({state.totalDelivered}/{config.totalPackets})</span>
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
            className="absolute top-2 rounded-xs border-2 border-[#10b981] pointer-events-none z-10 transition-transform"
            style={{
              width: `${bracketWidth}px`,
              height: `${BOX_HEIGHT}px`,
              transform: `translateX(${state.receiverBase * STEP}px)`,
              transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
            }}
          >
            {/* Sliding Bracket Tag */}
            <div className="absolute -top-3 left-0 text-[8px] font-mono font-bold text-[#10b981] whitespace-nowrap bg-[#09090b] px-1 rounded-xs border border-[#10b981]/40">
              {isGbn
                ? `EXPECT #${state.receiverBase}`
                : `RCV [${state.receiverBase} .. ${Math.min(state.receiverBase + config.windowSize - 1, config.totalPackets - 1)}]`}
            </div>
          </div>

          {/* STATIC HORIZONTAL RAIL OF NUMBERED BOXES */}
          <div className="absolute top-2 flex items-center gap-[6px]">
            {Array.from({ length: config.totalPackets }, (_, i) => {
              const slot = state.receiverSlots.get(i);
              const slotState: ReceiverSlotState = slot?.state ?? 'empty';

              let style = 'bg-[#18181b] border-[#27272a] text-[#71717a]';
              if (slotState === 'delivered') {
                style = 'bg-[#065f46] border-[#059669] text-[#34d399]';
              } else if (slotState === 'buffered') {
                style = 'bg-[#78350f]/40 border-[#d97706] text-[#fbbf24]';
              }

              return (
                <div
                  key={`receiver-box-${i}`}
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
                    {slotState === 'delivered' ? '✓ OK' : slotState === 'buffered' ? 'HELD' : 'WAIT'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
