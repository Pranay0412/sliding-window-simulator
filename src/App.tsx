import { useSimulator } from './hooks/useSimulator';
import { ControlBar } from './components/ControlBar';
import { SenderLane } from './components/SenderLane';
import { ChannelHighway } from './components/ChannelHighway';
import { ReceiverLane } from './components/ReceiverLane';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';

export default function App() {
  const sim = useSimulator();

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] text-zinc-300 overflow-hidden font-sans">
      {/* Top Control Bar */}
      <ControlBar
        config={sim.config}
        playState={sim.playState}
        isComplete={sim.state.isComplete}
        onUpdateConfig={sim.updateConfig}
        onPlay={sim.play}
        onPause={sim.pause}
        onStep={sim.stepForward}
        onReset={sim.reset}
      />

      {/* Main Workspace (70% Stage + 30% Diagnostics) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main Simulation Stage (70% Width) */}
        <div className="w-[70%] flex flex-col min-w-0 border-r border-[#27272a]">
          {/* Sender Buffer Lane with Smooth Sliding Bracket */}
          <SenderLane state={sim.state} config={sim.config} />

          {/* Bidirectional Channel Highway with Decoupled GPU Keyframe Motion */}
          <ChannelHighway
            state={sim.state}
            config={sim.config}
            playState={sim.playState}
            onDropPacket={sim.dropInFlight}
          />

          {/* Receiver Buffer Lane with Smooth Sliding Bracket */}
          <ReceiverLane state={sim.state} config={sim.config} />
        </div>

        {/* Diagnostics & Telemetry Rail (30% Width) */}
        <div className="w-[30%] min-w-[300px] flex flex-col overflow-hidden">
          <DiagnosticsPanel
            state={sim.state}
            config={sim.config}
            pendingDropFrame={sim.state.pendingDropFrame}
            pendingDropAck={sim.state.pendingDropAck}
            onToggleDropFrame={sim.toggleDropNextFrame}
            onToggleDropAck={sim.toggleDropNextAck}
          />
        </div>
      </div>
    </div>
  );
}
