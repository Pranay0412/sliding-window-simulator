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
      {/* Top Control Bar - Remains static at top */}
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

      {/* Main Workspace: Column on Mobile/Tablet, Row on Desktop */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        
        {/* Main Simulation Stage (Full width on mobile, 70% width on desktop) */}
        <div className="w-full lg:w-[70%] flex flex-col min-w-0 border-b lg:border-b-0 lg:border-r border-[#27272a] min-h-[580px] lg:min-h-0">
          {/* Sender Buffer Lane */}
          <SenderLane state={sim.state} config={sim.config} />

          {/* Bidirectional Channel Highway */}
          <ChannelHighway
            state={sim.state}
            config={sim.config}
            playState={sim.playState}
            onDropPacket={sim.dropInFlight}
          />

          {/* Receiver Buffer Lane */}
          <ReceiverLane state={sim.state} config={sim.config} />
        </div>

        {/* Diagnostics & Telemetry Rail (Full width on mobile, 30% width on desktop) */}
        <div className="w-full lg:w-[30%] lg:min-w-[300px] flex flex-col h-auto lg:h-full bg-[#0c0c0e]">
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
