import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimConfig, SimState, InFlightPacket, SenderSlot, ReceiverSlot, LogEntry } from '../engine/types';
import { DEFAULT_CONFIG, uid, resetUidCounter } from '../engine/types';

export type PlayState = 'idle' | 'playing' | 'paused';

export function useSimulator() {
  const [config, setConfig] = useState<SimConfig>({ ...DEFAULT_CONFIG });
  const [playState, setPlayState] = useState<PlayState>('idle');

  // Core simulation state
  const [state, setState] = useState<SimState>(() => createFreshState(DEFAULT_CONFIG));

  // Mutable refs for zero-lag decoupled execution
  const stateRef = useRef<SimState>(state);
  const configRef = useRef<SimConfig>(config);
  const playStateRef = useRef<PlayState>(playState);

  // Fault injection refs (immediate, non-batched)
  const pendingDropFrameRef = useRef<boolean>(false);
  const pendingDropAckRef = useRef<boolean>(false);

  // Active timers tracking
  const activeTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const gbnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const srTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Keep refs synchronized
  stateRef.current = state;
  configRef.current = config;
  playStateRef.current = playState;

  function safeSetTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      activeTimersRef.current.delete(timer);
      callback();
    }, ms);
    activeTimersRef.current.add(timer);
    return timer;
  }

  function clearAllTimers() {
    activeTimersRef.current.forEach((t) => clearTimeout(t));
    activeTimersRef.current.clear();

    if (gbnTimerRef.current !== null) {
      clearTimeout(gbnTimerRef.current);
      gbnTimerRef.current = null;
    }

    srTimersRef.current.forEach((t) => clearTimeout(t));
    srTimersRef.current.clear();
  }

  function appendLog(s: SimState, tag: LogEntry['tag'], message: string) {
    s.log.push({
      id: uid('log'),
      time: s.simTime,
      tag,
      message,
    });
  }

  function checkCompletion(s: SimState) {
    if (s.senderBase >= configRef.current.totalPackets && s.activePackets.length === 0) {
      s.isComplete = true;
      appendLog(s, 'DELIVER', `Transmission complete: all ${configRef.current.totalPackets} frames delivered & confirmed.`);
      setPlayState('paused');
    }
  }

  // --- DISPATCH FRAME ---
  const dispatchFrame = useCallback((seq: number, isRetransmission = false) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    if (!isRetransmission && seq >= cfg.totalPackets) return;

    // Check fault injection immediately
    const isLost = pendingDropFrameRef.current;
    if (isLost) {
      pendingDropFrameRef.current = false;
      s.pendingDropFrame = false;
    }

    const durationMs = Math.round((cfg.propagationDelay * 1000) / cfg.animationSpeed);

    const pkt: InFlightPacket = {
      id: uid('pkt'),
      seq,
      type: 'DATA',
      isRetransmission,
      isLost,
      slotIndex: seq % cfg.windowSize,
      createdAt: Date.now(),
      durationMs,
    };

    const slot = s.senderSlots.get(seq);
    if (slot) {
      slot.status = isLost ? 'dropped' : 'in-flight';
      if (cfg.protocol === 'sr') {
        slot.timerStart = Date.now();
        // Start SR independent timer
        startSrTimer(seq);
      }
    }

    s.activePackets = [...s.activePackets, pkt];
    if (!isRetransmission) {
      s.nextSeqNum = Math.max(s.nextSeqNum, seq + 1);
    }
    s.totalSent += 1;
    if (isRetransmission) {
      s.totalRetransmissions += 1;
    }

    if (isLost) {
      appendLog(s, 'DROP', `Frame #${seq} dispatched (fault injected: lost in transit)`);
    } else {
      appendLog(s, isRetransmission ? 'RETX' : 'TX', isRetransmission ? `Retransmitting Frame #${seq} → Receiver` : `Dispatched Frame #${seq} → Receiver`);
    }

    // Go-Back-N: single timer started for the oldest unacknowledged frame
    if (cfg.protocol === 'gbn' && s.gbnTimerStart === null) {
      s.gbnTimerStart = Date.now();
      startGbnTimer();
    }

    stateRef.current = s;
    setState(s);

    // Schedule arrival at receiver after hardware transit duration
    safeSetTimeout(() => {
      onFrameArrival(pkt.id, seq, isLost);
    }, durationMs);
  }, []);

  // --- RECEIVER: FRAME ARRIVAL ---
  const onFrameArrival = useCallback((packetId: string, seq: number, isLost: boolean) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    // Clean up packet from channel
    s.activePackets = s.activePackets.filter((p) => p.id !== packetId);

    if (isLost) {
      appendLog(s, 'DROP', `Frame #${seq} dropped in physical channel ✕`);
      stateRef.current = s;
      setState(s);
      return;
    }

    if (cfg.protocol === 'gbn') {
      if (seq === s.receiverBase) {
        // In-order frame received
        s.receiverSlots.set(seq, { seq, state: 'delivered' });
        s.receiverBase += 1;
        s.totalDelivered += 1;
        appendLog(s, 'DELIVER', `Frame #${seq} accepted in-order → Delivered`);

        // Send Cumulative ACK
        dispatchAck(seq, true);
      } else {
        // Out-of-order frame: DISCARD
        appendLog(s, 'RX', `Frame #${seq} DISCARDED (expected #${s.receiverBase})`);
        if (s.receiverBase > 0) {
          dispatchAck(s.receiverBase - 1, true);
        }
      }
    } else {
      // Selective Repeat (SR)
      const windowEnd = s.receiverBase + cfg.windowSize;
      if (seq >= s.receiverBase && seq < windowEnd) {
        // Send individual ACK
        dispatchAck(seq, false);

        const slot = s.receiverSlots.get(seq);
        const alreadyGot = slot && (slot.state === 'delivered' || slot.state === 'buffered');

        if (!alreadyGot) {
          if (seq === s.receiverBase) {
            // Base arrived: deliver base and contiguous buffered
            s.receiverSlots.set(seq, { seq, state: 'delivered' });
            s.totalDelivered += 1;
            appendLog(s, 'DELIVER', `Frame #${seq} delivered to Application Layer`);

            let next = s.receiverBase + 1;
            while (next < cfg.totalPackets) {
              const b = s.receiverSlots.get(next);
              if (b && b.state === 'buffered') {
                b.state = 'delivered';
                s.totalDelivered += 1;
                appendLog(s, 'DELIVER', `Buffered Frame #${next} contiguously delivered`);
                next++;
              } else {
                break;
              }
            }
            s.receiverBase = next;
            appendLog(s, 'SLIDE', `Receiver window slid to #${next}`);
          } else {
            // Buffer out-of-order
            s.receiverSlots.set(seq, { seq, state: 'buffered' });
            appendLog(s, 'BUFFER', `Frame #${seq} buffered out-of-order in receive window`);
          }
        }
      } else if (seq >= Math.max(0, s.receiverBase - cfg.windowSize) && seq < s.receiverBase) {
        // Re-ACK previously delivered frame
        dispatchAck(seq, false);
      }
    }

    stateRef.current = s;
    setState(s);
  }, []);

  // --- DISPATCH ACK ---
  const dispatchAck = useCallback((ackNum: number, isCumulative: boolean) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    // Check fault injection right at ACK formation
    const isLost = pendingDropAckRef.current;
    if (isLost) {
      pendingDropAckRef.current = false;
      s.pendingDropAck = false;
    }

    const durationMs = Math.round((cfg.propagationDelay * 1000) / cfg.animationSpeed);

    const ackPkt: InFlightPacket = {
      id: uid('ack'),
      seq: ackNum,
      type: 'ACK',
      isLost,
      isCumulative,
      slotIndex: ackNum % cfg.windowSize,
      createdAt: Date.now(),
      durationMs,
    };

    s.activePackets = [...s.activePackets, ackPkt];

    if (isLost) {
      appendLog(s, 'DROP', `${isCumulative ? 'Cumulative' : 'Individual'} ACK #${ackNum} dispatched (fault injected: lost in transit)`);
    } else {
      appendLog(s, 'ACK_TX', `${isCumulative ? 'Cumulative' : 'Individual'} ACK #${ackNum} dispatched → Sender`);
    }

    stateRef.current = s;
    setState(s);

    safeSetTimeout(() => {
      onAckArrival(ackPkt.id, ackNum, isLost);
    }, durationMs);
  }, []);

  // --- SENDER: ACK ARRIVAL ---
  const onAckArrival = useCallback((ackId: string, ackNum: number, isLost: boolean) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    s.activePackets = s.activePackets.filter((p) => p.id !== ackId);

    if (isLost) {
      appendLog(s, 'DROP', `ACK #${ackNum} dropped in reverse channel ✕`);
      stateRef.current = s;
      setState(s);
      return;
    }

    if (cfg.protocol === 'gbn') {
      if (ackNum >= s.senderBase) {
        const oldBase = s.senderBase;
        const newBase = ackNum + 1;

        // Confirm frames from oldBase to ackNum
        for (let i = oldBase; i <= ackNum; i++) {
          const slot = s.senderSlots.get(i);
          if (slot) {
            slot.status = 'acked';
            slot.timerStart = null;
          }
        }

        s.senderBase = newBase;
        appendLog(s, 'ACK_RX', `Cumulative ACK #${ackNum} confirmed frames [${oldBase} .. ${ackNum}]. Window slid to #${newBase}`);

        // Timer handling
        if (newBase >= s.nextSeqNum) {
          s.gbnTimerStart = null;
          if (gbnTimerRef.current !== null) {
            clearTimeout(gbnTimerRef.current);
            gbnTimerRef.current = null;
          }
        } else {
          // Restart timer for new base
          s.gbnTimerStart = Date.now();
          startGbnTimer();
        }

        stateRef.current = s;
        setState(s);

        // 1-for-1 sliding window: dispatch newly opened window slot(s)
        const openLimit = Math.min(newBase + cfg.windowSize, cfg.totalPackets);
        const toEmit: number[] = [];
        for (let seq = s.nextSeqNum; seq < openLimit; seq++) {
          toEmit.push(seq);
        }

        toEmit.forEach((seq, idx) => {
          safeSetTimeout(() => {
            if (playStateRef.current === 'playing') {
              dispatchFrame(seq, false);
            }
          }, idx * cfg.staggerMs);
        });

        checkCompletion(s);
      } else {
        appendLog(s, 'ACK_RX', `Duplicate ACK #${ackNum} received (ignored by sender)`);
        stateRef.current = s;
        setState(s);
      }
    } else {
      // Selective Repeat
      const slot = s.senderSlots.get(ackNum);
      if (slot && slot.status !== 'acked') {
        slot.status = 'acked';
        slot.timerStart = null;
        stopSrTimer(ackNum);
        appendLog(s, 'ACK_RX', `Individual ACK #${ackNum} confirmed Frame #${ackNum}`);

        // Slide window if ackNum is senderBase
        if (ackNum === s.senderBase) {
          let next = s.senderBase;
          while (next < cfg.totalPackets) {
            const cur = s.senderSlots.get(next);
            if (cur && cur.status === 'acked') {
              next++;
            } else {
              break;
            }
          }
          const distance = next - s.senderBase;
          s.senderBase = next;
          appendLog(s, 'SLIDE', `Sender window slid forward by ${distance} slot(s) → Base #${next}`);

          // 1-for-1 dispatch into opened slots
          const openLimit = Math.min(next + cfg.windowSize, cfg.totalPackets);
          const toEmit: number[] = [];
          for (let seq = s.nextSeqNum; seq < openLimit; seq++) {
            toEmit.push(seq);
          }

          toEmit.forEach((seq, idx) => {
            safeSetTimeout(() => {
              if (playStateRef.current === 'playing') {
                dispatchFrame(seq, false);
              }
            }, idx * cfg.staggerMs);
          });
        }

        checkCompletion(s);
        stateRef.current = s;
        setState(s);
      }
    }
  }, [dispatchAck]);

  // --- TIMERS ---
  function startGbnTimer() {
    if (gbnTimerRef.current !== null) {
      clearTimeout(gbnTimerRef.current);
    }
    const timeoutMs = (configRef.current.timeoutDuration * 1000) / configRef.current.animationSpeed;
    gbnTimerRef.current = setTimeout(() => {
      onGbnTimeout();
    }, timeoutMs);
  }

  function startSrTimer(seq: number) {
    if (srTimersRef.current.has(seq)) {
      clearTimeout(srTimersRef.current.get(seq)!);
    }
    const timeoutMs = (configRef.current.timeoutDuration * 1000) / configRef.current.animationSpeed;
    const timer = setTimeout(() => {
      onSrTimeout(seq);
    }, timeoutMs);
    srTimersRef.current.set(seq, timer);
  }

  function stopSrTimer(seq: number) {
    if (srTimersRef.current.has(seq)) {
      clearTimeout(srTimersRef.current.get(seq)!);
      srTimersRef.current.delete(seq);
    }
  }

  const onGbnTimeout = useCallback(() => {
    if (playStateRef.current !== 'playing') return;
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    const base = s.senderBase;
    appendLog(s, 'TIMEOUT', `TIMEOUT on oldest unACKed Frame #${base}! Retransmitting window...`);

    // Retransmit all unacknowledged frames in the window [base .. nextSeqNum - 1]
    const unacked: number[] = [];
    for (let i = base; i < s.nextSeqNum; i++) {
      const slot = s.senderSlots.get(i);
      if (slot && slot.status !== 'acked') {
        unacked.push(i);
      }
    }

    // Stagger retransmission (TU Berlin model)
    unacked.forEach((seq, idx) => {
      safeSetTimeout(() => {
        if (playStateRef.current === 'playing') {
          dispatchFrame(seq, true);
        }
      }, idx * cfg.staggerMs);
    });

    s.gbnTimerStart = Date.now();
    stateRef.current = s;
    setState(s);
    startGbnTimer();
  }, [dispatchFrame]);

  const onSrTimeout = useCallback((seq: number) => {
    if (playStateRef.current !== 'playing') return;
    const s = { ...stateRef.current };
    appendLog(s, 'TIMEOUT', `TIMEOUT for Frame #${seq}! Retransmitting selectively...`);

    dispatchFrame(seq, true);
    startSrTimer(seq);
  }, [dispatchFrame]);

  // --- ACTIONS ---
  const play = useCallback(() => {
    if (stateRef.current.isComplete) return;
    setPlayState('playing');

    const s = { ...stateRef.current };
    const cfg = configRef.current;

    // If starting initial burst from 0
    if (s.nextSeqNum === 0) {
      const burstLimit = Math.min(cfg.windowSize, cfg.totalPackets);
      for (let i = 0; i < burstLimit; i++) {
        safeSetTimeout(() => {
          if (playStateRef.current === 'playing') {
            dispatchFrame(i, false);
          }
        }, i * cfg.staggerMs);
      }
    } else {
      // Resume existing timers
      if (cfg.protocol === 'gbn' && s.gbnTimerStart !== null) {
        startGbnTimer();
      }
    }
  }, [dispatchFrame]);

  const pause = useCallback(() => {
    setPlayState('paused');
    clearAllTimers();
  }, []);

  const reset = useCallback(() => {
    clearAllTimers();
    pendingDropFrameRef.current = false;
    pendingDropAckRef.current = false;

    const fresh = createFreshState(configRef.current);
    stateRef.current = fresh;
    setState(fresh);
    setPlayState('idle');
  }, []);

  const stepForward = useCallback(() => {
    if (stateRef.current.isComplete) return;
    setPlayState('paused');

    const s = stateRef.current;
    const cfg = configRef.current;

    // Dispatch next frame if window allows
    if (s.nextSeqNum < Math.min(s.senderBase + cfg.windowSize, cfg.totalPackets)) {
      dispatchFrame(s.nextSeqNum, false);
    }
  }, [dispatchFrame]);

  const dropInFlight = useCallback((id: string) => {
    const s = { ...stateRef.current };
    const pkt = s.activePackets.find((p) => p.id === id);
    if (!pkt) return;

    pkt.isLost = true;
    appendLog(s, 'DROP', `${pkt.type === 'DATA' ? 'Frame' : 'ACK'} #${pkt.seq} killed by operator ✕`);

    if (pkt.type === 'DATA') {
      const slot = s.senderSlots.get(pkt.seq);
      if (slot) slot.status = 'dropped';
    }

    stateRef.current = s;
    setState(s);
  }, []);

  const toggleDropNextFrame = useCallback(() => {
    const nextVal = !pendingDropFrameRef.current;
    pendingDropFrameRef.current = nextVal;
    setState((prev) => ({ ...prev, pendingDropFrame: nextVal }));
  }, []);

  const toggleDropNextAck = useCallback(() => {
    const nextVal = !pendingDropAckRef.current;
    pendingDropAckRef.current = nextVal;
    setState((prev) => ({ ...prev, pendingDropAck: nextVal }));
  }, []);

  const updateConfig = useCallback((partial: Partial<SimConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      configRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, []);

  return {
    config,
    state,
    playState,
    updateConfig,
    play,
    pause,
    reset,
    stepForward,
    dropInFlight,
    toggleDropNextFrame,
    toggleDropNextAck,
  };
}

function createFreshState(config: SimConfig): SimState {
  resetUidCounter();
  const total = config.totalPackets;
  const senderSlots = new Map<number, SenderSlot>();
  const receiverSlots = new Map<number, ReceiverSlot>();

  for (let i = 0; i < total; i++) {
    senderSlots.set(i, {
      seq: i,
      status: 'unsent',
      timerStart: null,
      timeoutFlashUntil: null,
    });
    receiverSlots.set(i, {
      seq: i,
      state: 'empty',
    });
  }

  return {
    simTime: 0,
    senderBase: 0,
    nextSeqNum: 0,
    receiverBase: 0,
    senderSlots,
    receiverSlots,
    activePackets: [],
    log: [
      {
        id: uid('log'),
        time: 0,
        tag: 'SLIDE',
        message: `Simulator ready for ${config.protocol.toUpperCase()} (N=${config.windowSize}).`,
      },
    ],
    gbnTimerStart: null,
    gbnTimeoutFlashUntil: null,
    totalSent: 0,
    totalRetransmissions: 0,
    totalDelivered: 0,
    pendingDropFrame: false,
    pendingDropAck: false,
    isComplete: false,
  };
}
