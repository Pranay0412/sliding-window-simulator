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

  // Fault injection refs
  const pendingDropFrameRef = useRef<boolean>(false);
  const pendingDropAckRef = useRef<boolean>(false);
  const gbnDropAckBurstRef = useRef<boolean>(false);

  // Inbound ACK stream sequencing
  const nextAckDispatchTimeRef = useRef<number>(0);

  // Active timers tracking
  const activeTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const gbnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const srTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Keep refs synchronized
  stateRef.current = state;
  configRef.current = config;
  playStateRef.current = playState;

  function safeSetTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      activeTimeoutsRef.current.delete(timer);
      callback();
    }, ms);
    activeTimeoutsRef.current.add(timer);
    return timer;
  }

  function clearAllTimers() {
    activeTimeoutsRef.current.forEach((t) => clearTimeout(t));
    activeTimeoutsRef.current.clear();

    if (gbnTimerRef.current !== null) {
      clearTimeout(gbnTimerRef.current);
      gbnTimerRef.current = null;
    }

    srTimersRef.current.forEach((t) => clearTimeout(t));
    srTimersRef.current.clear();
  }

  function appendLog(s: SimState, tag: LogEntry['tag'], message: string) {
    const nextLog: LogEntry[] = [
      ...s.log,
      {
        id: uid('log'),
        time: Number(s.simTime.toFixed(2)),
        tag,
        message,
      },
    ];
    s.log = nextLog.slice(-50);
  }

  function checkCompletion(s: SimState) {
    if (s.senderBase >= configRef.current.totalPackets) {
      s.isComplete = true;
      clearAllTimers();
      appendLog(s, 'DELIVER', `Transmission complete: all ${configRef.current.totalPackets} frames delivered & confirmed.`);
      setPlayState('paused');
    }
  }

  // --- SENDER TIMERS ---
  const startGbnTimer = useCallback(() => {
    if (gbnTimerRef.current !== null) {
      clearTimeout(gbnTimerRef.current);
      gbnTimerRef.current = null;
    }
    const timeoutMs = (configRef.current.timeoutDuration * 1000) / configRef.current.animationSpeed;
    gbnTimerRef.current = setTimeout(() => {
      onGbnTimeout();
    }, timeoutMs);
  }, []);

  const stopGbnTimer = useCallback(() => {
    if (gbnTimerRef.current !== null) {
      clearTimeout(gbnTimerRef.current);
      gbnTimerRef.current = null;
    }
  }, []);

  const startSrTimer = useCallback((seq: number) => {
    if (srTimersRef.current.has(seq)) {
      clearTimeout(srTimersRef.current.get(seq)!);
    }
    const timeoutMs = (configRef.current.timeoutDuration * 1000) / configRef.current.animationSpeed;
    const timer = setTimeout(() => {
      onSrTimeout(seq);
    }, timeoutMs);
    srTimersRef.current.set(seq, timer);
  }, []);

  const stopSrTimer = useCallback((seq: number) => {
    if (srTimersRef.current.has(seq)) {
      clearTimeout(srTimersRef.current.get(seq)!);
      srTimersRef.current.delete(seq);
    }
  }, []);

  // --- DISPATCH FRAME (OUTBOUND LANE ↓) ---
  const dispatchFrame = useCallback((seq: number, isRetransmission = false) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    if (s.isComplete || (!isRetransmission && seq >= cfg.totalPackets)) return;

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
      createdAt: Date.now(),
      durationMs,
    };

    const slot = s.senderSlots.get(seq);
    if (slot) {
      slot.status = 'in-flight';
      slot.timeoutFlashUntil = null;
      if (cfg.protocol === 'sr') {
        slot.timerStart = Date.now();
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

    if (cfg.protocol === 'gbn' && s.gbnTimerStart === null) {
      s.gbnTimerStart = Date.now();
      startGbnTimer();
    }

    if (isLost) {
      appendLog(s, 'DROP', `Frame #${seq} dispatched (fault injected: lost in transit ✕)`);
    } else {
      appendLog(
        s,
        isRetransmission ? 'RETX' : 'TX',
        isRetransmission ? `Retransmitting Frame #${seq} → Receiver` : `Dispatched Frame #${seq} → Receiver`,
      );
    }

    stateRef.current = s;
    setState(s);

    if (isLost) {
      safeSetTimeout(() => {
        const cur = { ...stateRef.current };
        cur.activePackets = cur.activePackets.filter((p) => p.id !== pkt.id);
        const curSlot = cur.senderSlots.get(seq);
        if (curSlot && curSlot.status !== 'acked') {
          curSlot.status = 'dropped';
        }
        appendLog(cur, 'DROP', `Frame #${seq} dropped in forward channel ✕`);
        stateRef.current = cur;
        setState(cur);
      }, Math.round(durationMs * 0.65));
    } else {
      safeSetTimeout(() => {
        onFrameArrival(pkt.id, seq);
      }, durationMs);
    }
  }, [startGbnTimer, startSrTimer]);

  // --- DISPATCH ACK (INBOUND LANE ↑) ---
  const sendAck = useCallback((ackNum: number, isCumulative: boolean, s: SimState) => {
    const cfg = configRef.current;
    let isLost = false;

    if (cfg.protocol === 'gbn') {
      if (gbnDropAckBurstRef.current) {
        isLost = true;
      }
    } else {
      if (pendingDropAckRef.current) {
        pendingDropAckRef.current = false;
        s.pendingDropAck = false;
        isLost = true;
      }
    }

    const durationMs = Math.round((cfg.propagationDelay * 1000) / cfg.animationSpeed);
    const minGap = Math.round(150 / cfg.animationSpeed);
    const now = Date.now();
    const scheduledTime = Math.max(now, nextAckDispatchTimeRef.current);
    const dispatchDelay = scheduledTime - now;
    nextAckDispatchTimeRef.current = scheduledTime + minGap;

    if (dispatchDelay === 0) {
      const ackPkt: InFlightPacket = {
        id: uid('ack'),
        seq: ackNum,
        type: 'ACK',
        isLost,
        isCumulative,
        createdAt: now,
        durationMs,
      };

      s.activePackets = [...s.activePackets, ackPkt];

      if (isLost) {
        appendLog(s, 'DROP', `${isCumulative ? 'Cumulative' : 'Individual'} ACK #${ackNum} dispatched (fault injected: will drop in transit ✕)`);
        safeSetTimeout(() => {
          const cur = { ...stateRef.current };
          cur.activePackets = cur.activePackets.filter((p) => p.id !== ackPkt.id);
          appendLog(cur, 'DROP', `ACK #${ackNum} dropped in reverse channel ✕`);
          stateRef.current = cur;
          setState(cur);
        }, Math.round(durationMs * 0.65));
      } else {
        appendLog(s, 'ACK_TX', `${isCumulative ? 'Cumulative' : 'Individual'} ACK #${ackNum} dispatched → Sender`);
        safeSetTimeout(() => {
          onAckArrival(ackPkt.id, ackNum, isCumulative);
        }, durationMs);
      }
    } else {
      safeSetTimeout(() => {
        const cur = { ...stateRef.current };
        const curAckPkt: InFlightPacket = {
          id: uid('ack'),
          seq: ackNum,
          type: 'ACK',
          isLost,
          isCumulative,
          createdAt: Date.now(),
          durationMs,
        };

        cur.activePackets = [...cur.activePackets, curAckPkt];

        if (isLost) {
          appendLog(cur, 'DROP', `${isCumulative ? 'Cumulative' : 'Individual'} ACK #${ackNum} dispatched (fault injected: will drop in transit ✕)`);
          safeSetTimeout(() => {
            const c = { ...stateRef.current };
            c.activePackets = c.activePackets.filter((p) => p.id !== curAckPkt.id);
            appendLog(c, 'DROP', `ACK #${ackNum} dropped in reverse channel ✕`);
            stateRef.current = c;
            setState(c);
          }, Math.round(durationMs * 0.65));
        } else {
          appendLog(cur, 'ACK_TX', `${isCumulative ? 'Cumulative' : 'Individual'} ACK #${ackNum} dispatched → Sender`);
          safeSetTimeout(() => {
            onAckArrival(curAckPkt.id, ackNum, isCumulative);
          }, durationMs);
        }

        stateRef.current = cur;
        setState(cur);
      }, dispatchDelay);
    }
  }, []);

  // --- RECEIVER: FRAME ARRIVAL (BOTTOM) ---
  const onFrameArrival = useCallback((packetId: string, seq: number) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    const pkt = s.activePackets.find((p) => p.id === packetId);
    if (!pkt || pkt.isLost) return;

    s.activePackets = s.activePackets.filter((p) => p.id !== packetId);

    if (cfg.protocol === 'gbn') {
      if (seq === s.receiverBase) {
        s.receiverSlots.set(seq, { seq, state: 'delivered' });
        s.receiverBase += 1;
        s.totalDelivered += 1;
        appendLog(s, 'DELIVER', `Frame #${seq} accepted in-order → Delivered`);
        sendAck(seq, true, s);
      } else {
        appendLog(s, 'RX', `Frame #${seq} DISCARDED (expected #${s.receiverBase})`);
        if (s.receiverBase > 0) {
          sendAck(s.receiverBase - 1, true, s);
        }
      }
    } else {
      // Selective Repeat (SR): Always send ACK back for valid window frame
      const windowEnd = s.receiverBase + cfg.windowSize;
      if (seq >= s.receiverBase && seq < windowEnd) {
        sendAck(seq, false, s);

        const slot = s.receiverSlots.get(seq);
        const alreadyGot = slot && (slot.state === 'delivered' || slot.state === 'buffered');

        if (!alreadyGot) {
          if (seq === s.receiverBase) {
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
            s.receiverSlots.set(seq, { seq, state: 'buffered' });
            appendLog(s, 'BUFFER', `Frame #${seq} buffered out-of-order in receive window`);
          }
        }
      } else if (seq >= Math.max(0, s.receiverBase - cfg.windowSize) && seq < s.receiverBase) {
        // Re-ACK previously delivered frame
        sendAck(seq, false, s);
      }
    }

    stateRef.current = s;
    setState(s);
  }, [sendAck]);

  // --- SENDER: ACK ARRIVAL (TOP) ---
  const onAckArrival = useCallback((ackId: string, ackNum: number, _isCumulative: boolean) => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    const ack = s.activePackets.find((p) => p.id === ackId);
    if (!ack || ack.isLost) return;

    s.activePackets = s.activePackets.filter((p) => p.id !== ackId);

    if (cfg.protocol === 'gbn') {
      if (ackNum >= s.senderBase) {
        const oldBase = s.senderBase;
        const newBase = ackNum + 1;

        for (let i = oldBase; i <= ackNum; i++) {
          const slot = s.senderSlots.get(i);
          if (slot) {
            slot.status = 'acked';
            slot.timerStart = null;
            slot.timeoutFlashUntil = null;
          }
        }

        s.senderBase = newBase;
        appendLog(s, 'ACK_RX', `Cumulative ACK #${ackNum} arrived at sender. Confirmed frames [${oldBase} .. ${ackNum}]. Window slid to #${newBase}`);

        if (newBase >= s.nextSeqNum || newBase >= cfg.totalPackets) {
          s.gbnTimerStart = null;
          stopGbnTimer();
        } else {
          s.gbnTimerStart = Date.now();
          startGbnTimer();
        }

        // 1-for-1 sliding pipeline dispatch
        const openLimit = Math.min(newBase + cfg.windowSize, cfg.totalPackets);
        const toEmit: number[] = [];
        for (let seq = s.nextSeqNum; seq < openLimit; seq++) {
          toEmit.push(seq);
        }
        s.nextSeqNum = Math.max(s.nextSeqNum, openLimit);

        stateRef.current = s;
        setState(s);

        const staggerGap = Math.round(220 / cfg.animationSpeed);
        toEmit.forEach((seq, idx) => {
          safeSetTimeout(() => {
            if (playStateRef.current === 'playing' && !stateRef.current.isComplete) {
              dispatchFrame(seq, false);
            }
          }, idx * staggerGap);
        });

        checkCompletion(s);
      } else {
        appendLog(s, 'ACK_RX', `Duplicate ACK #${ackNum} arrived (ignored by sender)`);
        stateRef.current = s;
        setState(s);
      }
    } else {
      // Selective Repeat (SR)
      const slot = s.senderSlots.get(ackNum);
      if (slot && slot.status !== 'acked') {
        slot.status = 'acked';
        slot.timerStart = null;
        slot.timeoutFlashUntil = null;
        stopSrTimer(ackNum);
        appendLog(s, 'ACK_RX', `Individual ACK #${ackNum} arrived at sender. Confirmed Frame #${ackNum}`);

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

          const openLimit = Math.min(next + cfg.windowSize, cfg.totalPackets);
          const toEmit: number[] = [];
          for (let seq = s.nextSeqNum; seq < openLimit; seq++) {
            toEmit.push(seq);
          }
          s.nextSeqNum = Math.max(s.nextSeqNum, openLimit);

          stateRef.current = s;
          setState(s);

          const staggerGap = Math.round(220 / cfg.animationSpeed);
          toEmit.forEach((seq, idx) => {
            safeSetTimeout(() => {
              if (playStateRef.current === 'playing' && !stateRef.current.isComplete) {
                dispatchFrame(seq, false);
              }
            }, idx * staggerGap);
          });
        } else {
          stateRef.current = s;
          setState(s);
        }

        checkCompletion(s);
      } else {
        stateRef.current = s;
        setState(s);
      }
    }
  }, [dispatchFrame, startGbnTimer, stopGbnTimer, stopSrTimer]);

  // --- TIMEOUT HANDLERS ---
  const onGbnTimeout = useCallback(() => {
    if (playStateRef.current !== 'playing') return;
    const s = { ...stateRef.current };
    const cfg = configRef.current;
    if (s.isComplete || s.senderBase >= cfg.totalPackets) return;

    const base = s.senderBase;
    gbnDropAckBurstRef.current = false;
    s.pendingDropAck = false;

    const baseSlot = s.senderSlots.get(base);
    if (baseSlot) {
      baseSlot.status = 'timeout';
      baseSlot.timeoutFlashUntil = Date.now() + 800;
    }

    appendLog(
      s,
      'TIMEOUT',
      `TIMEOUT on oldest unACKed Frame #${base}! Retransmitting window [${base}..${Math.min(s.nextSeqNum - 1, base + cfg.windowSize - 1)}]...`
    );

    const unacked: number[] = [];
    const windowEnd = Math.min(s.nextSeqNum, base + cfg.windowSize);
    for (let i = base; i < windowEnd; i++) {
      const slot = s.senderSlots.get(i);
      if (slot && slot.status !== 'acked') {
        unacked.push(i);
      }
    }

    if (gbnTimerRef.current !== null) {
      clearTimeout(gbnTimerRef.current);
      gbnTimerRef.current = null;
    }

    s.gbnTimerStart = null;

    stateRef.current = s;
    setState(s);

    const staggerGap = Math.round(220 / cfg.animationSpeed);
    unacked.forEach((seq, idx) => {
      safeSetTimeout(() => {
        if (playStateRef.current === 'playing' && !stateRef.current.isComplete) {
          dispatchFrame(seq, true);
        }
      }, idx * staggerGap);
    });
  }, [dispatchFrame]); 


  const onSrTimeout = useCallback((seq: number) => {
    if (playStateRef.current !== 'playing') return;
    const s = { ...stateRef.current };
    const cfg = configRef.current;
    if (s.isComplete || s.senderBase >= cfg.totalPackets) return;

    const slot = s.senderSlots.get(seq);
    if (slot && slot.status !== 'acked' && seq >= s.senderBase && seq < s.senderBase + cfg.windowSize) {
      slot.status = 'timeout';
      slot.timeoutFlashUntil = Date.now() + 800;
      appendLog(s, 'TIMEOUT', `TIMEOUT for Frame #${seq}! Retransmitting selectively...`);
      
      stateRef.current = s;
      setState(s);
      dispatchFrame(seq, true);
    } else {
      stopSrTimer(seq);
    }
  }, [dispatchFrame, stopSrTimer]);


  // --- VIRTUAL SIMULATION CLOCK TICK ---
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (playState === 'playing') {
      interval = setInterval(() => {
        setState((prev) => {
          if (prev.isComplete) return prev;
          const nextTime = Number((prev.simTime + 0.05 * configRef.current.animationSpeed).toFixed(2));
          const updated = { ...prev, simTime: nextTime };
          stateRef.current = updated;
          return updated;
        });
      }, 50);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [playState]);

  // --- USER ACTIONS ---
  const play = useCallback(() => {
    if (stateRef.current.isComplete) return;
    setPlayState('playing');

    const s = { ...stateRef.current };
    const cfg = configRef.current;

    if (s.nextSeqNum === 0) {
      const burstLimit = Math.min(cfg.windowSize, cfg.totalPackets);
      const staggerGap = Math.round(220 / cfg.animationSpeed);
      for (let i = 0; i < burstLimit; i++) {
        safeSetTimeout(() => {
          if (playStateRef.current === 'playing') {
            dispatchFrame(i, false);
          }
        }, i * staggerGap);
      }
    } else {
      if (cfg.protocol === 'gbn' && s.gbnTimerStart !== null) {
        startGbnTimer();
      }
      if (cfg.protocol === 'sr') {
        s.senderSlots.forEach((slot, seq) => {
          if (slot.status === 'in-flight' && slot.timerStart !== null) {
            startSrTimer(seq);
          }
        });
      }
    }
  }, [dispatchFrame, startGbnTimer, startSrTimer]);

  const pause = useCallback(() => {
    setPlayState('paused');
    clearAllTimers();
  }, []);

  const reset = useCallback(() => {
    clearAllTimers();
    pendingDropFrameRef.current = false;
    pendingDropAckRef.current = false;
    gbnDropAckBurstRef.current = false;
    nextAckDispatchTimeRef.current = 0;

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

    if (s.nextSeqNum < Math.min(s.senderBase + cfg.windowSize, cfg.totalPackets)) {
      dispatchFrame(s.nextSeqNum, false);
    }
  }, [dispatchFrame]);

  const dropInFlight = useCallback((id: string) => {
    const s = { ...stateRef.current };
    const pkt = s.activePackets.find((p) => p.id === id);
    if (!pkt || pkt.isLost) return;

    pkt.isLost = true;
    appendLog(s, 'DROP', `${pkt.type === 'DATA' ? 'Frame' : 'ACK'} #${pkt.seq} killed by operator ✕`);

    if (pkt.type === 'DATA') {
      const slot = s.senderSlots.get(pkt.seq);
      if (slot && slot.status !== 'acked') {
        slot.status = 'dropped';
      }
    }

    stateRef.current = s;
    setState(s);

    safeSetTimeout(() => {
      const cur = { ...stateRef.current };
      cur.activePackets = cur.activePackets.filter((p) => p.id !== id);
      stateRef.current = cur;
      setState(cur);
    }, 600);
  }, []);

  const toggleDropNextFrame = useCallback(() => {
    const nextVal = !pendingDropFrameRef.current;
    pendingDropFrameRef.current = nextVal;
    setState((prev) => ({ ...prev, pendingDropFrame: nextVal }));
  }, []);

  const toggleDropNextAck = useCallback(() => {
    const s = { ...stateRef.current };
    const cfg = configRef.current;

    if (cfg.protocol === 'gbn') {
      const willArm = !gbnDropAckBurstRef.current;
      gbnDropAckBurstRef.current = willArm;
      s.pendingDropAck = willArm;

      if (willArm) {
        let droppedAny = false;
        s.activePackets = s.activePackets.map((pkt) => {
          if (pkt.type === 'ACK' && !pkt.isLost) {
            droppedAny = true;
            return { ...pkt, isLost: true };
          }
          return pkt;
        });

        appendLog(
          s,
          'DROP',
          droppedAny
            ? `Reverse channel burst dropped: active in-flight ACK(s) killed ✕ (awaiting sender timeout)`
            : `Reverse channel fault armed: in-flight wave ACKs will drop ✕ (awaiting sender timeout)`
        );
      } else {
        appendLog(s, 'TX', `Reverse channel fault disarmed`);
      }

      stateRef.current = s;
      setState(s);
    } else {
      const nextVal = !pendingDropAckRef.current;
      pendingDropAckRef.current = nextVal;
      setState((prev) => ({ ...prev, pendingDropAck: nextVal }));
    }
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
    totalSent: 0,
    totalRetransmissions: 0,
    totalDelivered: 0,
    pendingDropFrame: false,
    pendingDropAck: false,
    isComplete: false,
  };
}