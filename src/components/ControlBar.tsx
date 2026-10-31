import React from 'react';
import { cn } from '../lib/utils';
import type { SimConfig, ProtocolType } from '../engine/types';
import type { PlayState } from '../hooks/useSimulator';
import { Play, Pause, StepForward, RotateCcw } from 'lucide-react';

interface ControlBarProps {
  config: SimConfig;
  playState: PlayState;
  isComplete: boolean;
  onUpdateConfig: (partial: Partial<SimConfig>) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
}

export const ControlBar = React.memo(function ControlBar({
  config,
  playState,
  isComplete,
  onUpdateConfig,
  onPlay,
  onPause,
  onStep,
  onReset,
}: ControlBarProps) {
  const protocols: { key: ProtocolType; label: string }[] = [
    { key: 'gbn', label: 'Go-Back-N (GBN)' },
    { key: 'sr', label: 'Selective Repeat (SR)' },
  ];

  const speeds = [0.5, 1.0, 2.0];

  return (
    <header className="flex-shrink-0 bg-[#0c0c0e] border-b border-[#27272a] px-4 py-2 select-none">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left Section: Branding & Protocol Selector */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 pr-3 border-r border-[#27272a]">
            <span className="font-mono font-bold text-xs tracking-wider text-zinc-200">
              SLIDING_WINDOW
            </span>
          </div>

          {/* Protocol Toggle Buttons */}
          <div className="flex rounded-sm bg-[#18181b] p-0.5 border border-[#27272a]">
            {protocols.map((p) => {
              const active = config.protocol === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    if (config.protocol !== p.key) {
                      onUpdateConfig({ protocol: p.key });
                      onReset();
                    }
                  }}
                  className={cn(
                    'px-3 py-1 font-mono text-[11px] font-medium transition-all rounded-xs cursor-pointer',
                    active
                      ? 'bg-[#27272a] text-white shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Section: Playback / Step / Reset Execution Engine */}
        <div className="flex items-center gap-1.5">
          {playState === 'playing' ? (
            <button
              onClick={onPause}
              className="flex items-center gap-1.5 px-3 py-1 rounded-sm bg-[#27272a] hover:bg-[#3f3f46] text-white border border-[#3f3f46] text-xs font-mono font-medium transition-colors cursor-pointer"
              title="Pause Simulation"
            >
              <Pause size={12} />
              <span>PAUSE</span>
            </button>
          ) : (
            <button
              onClick={onPlay}
              disabled={isComplete}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs font-mono font-medium transition-colors border cursor-pointer',
                isComplete
                  ? 'opacity-40 cursor-not-allowed bg-[#18181b] text-zinc-500 border-[#27272a]'
                  : 'bg-[#065f46] hover:bg-[#047857] text-[#a7f3d0] border-[#059669]',
              )}
              title="Run Simulation"
            >
              <Play size={12} />
              <span>PLAY</span>
            </button>
          )}

          <button
            onClick={onStep}
            disabled={isComplete || playState === 'playing'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-mono font-medium transition-colors border cursor-pointer',
              isComplete || playState === 'playing'
                ? 'opacity-40 cursor-not-allowed bg-[#18181b] text-zinc-500 border-[#27272a]'
                : 'bg-[#18181b] hover:bg-[#27272a] text-zinc-200 border-[#27272a]',
            )}
            title="Execute 1 Single Simulation Tick (Viva Walkthrough)"
          >
            <StepForward size={12} />
            <span>STEP</span>
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1 px-2.5 py-1 rounded-sm bg-[#18181b] hover:bg-[#27272a] text-zinc-400 hover:text-zinc-200 border border-[#27272a] text-xs font-mono font-medium transition-colors cursor-pointer"
            title="Reset Simulation State"
          >
            <RotateCcw size={12} />
            <span>RESET</span>
          </button>
        </div>

        {/* Right Section: Configuration Inputs */}
        <div className="flex items-center gap-4 text-xs font-mono">
          {/* Window Size Slider */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-zinc-500 font-semibold">
              Window (N)
            </span>
            <input
              type="range"
              min={2}
              max={8}
              step={1}
              value={config.windowSize}
              disabled={playState === 'playing'}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onUpdateConfig({ windowSize: val });
                if (playState === 'idle') onReset();
              }}
              className="w-16 h-1 accent-[#3b82f6] cursor-pointer disabled:opacity-40"
            />
            <span className="w-4 text-right font-bold text-zinc-300">
              {config.windowSize}
            </span>
          </div>

          <div className="h-4 w-px bg-[#27272a]" />

          {/* Total Packets Slider */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-zinc-500 font-semibold">
              Frames
            </span>
            <input
              type="range"
              min={10}
              max={20}
              step={1}
              value={config.totalPackets}
              disabled={playState === 'playing'}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onUpdateConfig({ totalPackets: val });
                if (playState === 'idle') onReset();
              }}
              className="w-16 h-1 accent-[#3b82f6] cursor-pointer disabled:opacity-40"
            />
            <span className="w-5 text-right font-bold text-zinc-300">
              {config.totalPackets}
            </span>
          </div>

          <div className="h-4 w-px bg-[#27272a]" />

          {/* Timeout Duration */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase text-zinc-500 font-semibold">
              Timeout
            </span>
            <input
              type="range"
              min={2}
              max={10}
              step={0.5}
              value={config.timeoutDuration}
              onChange={(e) => onUpdateConfig({ timeoutDuration: parseFloat(e.target.value) })}
              className="w-14 h-1 accent-[#f59e0b] cursor-pointer"
            />
            <span className="w-7 text-right font-bold text-zinc-300">
              {config.timeoutDuration}s
            </span>
          </div>

          <div className="h-4 w-px bg-[#27272a]" />

          {/* Speed Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase text-zinc-500 font-semibold">
              Speed
            </span>
            <div className="flex rounded-sm bg-[#18181b] p-0.5 border border-[#27272a]">
              {speeds.map((s) => (
                <button
                  key={s}
                  onClick={() => onUpdateConfig({ animationSpeed: s })}
                  className={cn(
                    'px-1.5 py-0.5 text-[10px] font-mono rounded-xs transition-colors cursor-pointer',
                    config.animationSpeed === s
                      ? 'bg-[#27272a] text-white font-bold'
                      : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});
