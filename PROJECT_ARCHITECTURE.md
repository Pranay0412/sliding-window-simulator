# Sliding Window Protocol Simulator: Architecture & Viva Guide (GBN & SR)

> **Document Type:** Developer Reference & Technical Viva Examination Handbook  
> **Theoretical Models:** TU Berlin (Johannes Kessler reference model) & Kurose & Ross (*Computer Networking: A Top-Down Approach*).  
> **Aesthetic Standard:** Industrial Network Diagnostic Interface (`#09090b` matte canvas, `#27272a` borders, JetBrains Mono typography, GPU-accelerated CSS animations).

---

## 1. System Architecture & Module Map

```
d:/sliding-window-simulator/
├── gbn_sr.c                  # Standalone ANSI C99/C11 discrete simulation engine for lab submission
├── PROJECT_ARCHITECTURE.md   # Architectural blueprint and viva defense handbook
├── index.html                # HTML5 entry with Inter and JetBrains Mono fonts
├── package.json              # Dependencies and Vite scripts
├── tailwind.config.js        # Matte dark tokens and typography extensions
├── tsconfig.json             # Root TypeScript references
├── tsconfig.app.json         # Strict TypeScript compiler options
└── src/
    ├── main.tsx              # React 19 entry with StrictMode
    ├── index.css             # Matte industrial base styling, custom scrollbars, and GPU keyframes
    ├── App.tsx               # Master 3-tier view coordinator (70% Stage + 30% Diagnostics Rail)
    ├── lib/
    │   └── utils.ts          # clsx + tailwind-merge helper
    ├── engine/
    │   └── types.ts          # Domain types, packet schemas, and telemetry state models
    ├── hooks/
    │   └── useSimulator.ts   # Event-driven TU Berlin engine, pipeline dispatch, and state bridge
    └── components/
        ├── ControlBar.tsx    # Tier 1: Protocol tabs, Play/Pause/Step/Reset, and config inputs
        ├── SenderLane.tsx    # Tier 2 Top: Static rail + floating sliding bracket [Base..Base+N-1]
        ├── ChannelHighway.tsx# Tier 2 Middle: Bidirectional highway (Down: PKT, Up: ACK) + hover drop
        ├── ReceiverLane.tsx  # Tier 2 Bottom: Static rail + floating sliding bracket (GBN Wr=1 / SR Wr=N)
        └── DiagnosticsPanel.tsx# Tier 3: Telemetry strip, fault injection buttons, and event stream
```

---

## 2. Decoupled GPU-Accelerated Animation Mechanics

### Eliminating Motion Lag & State Jitter
In conventional simulators, recalculating $X/Y$ percentages inside a 16ms React render loop causes severe stutter and garbage collection pauses.

The simulator completely decouples travel animations from React render cycles:
1. **GPU Keyframe Animations:**
   ```css
   @keyframes travelDown {
     0% { transform: translateY(0); opacity: 0; }
     8% { opacity: 1; }
     92% { opacity: 1; }
     100% { transform: translateY(var(--travel-distance, 200px)); opacity: 0.85; }
   }
   @keyframes travelUp {
     0% { transform: translateY(var(--travel-distance, 200px)); opacity: 0; }
     8% { opacity: 1; }
     92% { opacity: 1; }
     100% { transform: translateY(0); opacity: 0.85; }
   }
   ```
2. **Zero In-Transit React State Rerenders:**
   - Packets and ACKs travel across the propagation medium using `animation: travelDown ${duration}ms linear forwards; will-change: transform;`.
   - The browser's GPU compositor handles the linear translation at native 60/120 FPS.
   - React state updates strictly on discrete protocol events: `DISPATCH`, `DELIVER`, `DROP`, `TIMEOUT`, and `SLIDE`.

---

## 3. Smooth 1-for-1 Sliding Window (TU Berlin Mechanics)

### A. Visual Floating Sliding Bracket
- Both Sender and Receiver buffers are rendered as static horizontal rails of compact boxes (38×42px, labeled `0` to `Total - 1`).
- A floating active window bracket container overlays the rail:
  ```tsx
  style={{
    width: `${windowWidth}px`,
    transform: `translateX(${baseIndex * 44}px)`,
    transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
  }}
  ```
- When an ACK arrives, incrementing $S_{\text{base}}$ makes the bracket glide smoothly to the right by exactly 1 box width (44px) without clumping or jumping.

### B. Natural Staggered Pipeline Dispatch
- Packets are never dumped simultaneously at the same millisecond.
- At initialization or upon timeout retransmission, frames are staggered with an inter-packet gap:
  ```ts
  framesToSend.forEach((seq, idx) => setTimeout(() => dispatch(seq), idx * 250));
  ```
- In steady state: when 1 ACK arrives $\rightarrow$ window slides by 1 $\rightarrow$ exactly 1 new frame is dispatched to fill the open slot.

---

## 4. Protocol State Machine Invariants (Kurose & Ross / TU Berlin)

### Go-Back-N (GBN)
1. **Sender Window:** Size $N$ ($[S_{\text{base}} \dots S_{\text{base}} + N - 1]$).
2. **Receiver Window:** $W_r = 1$, tracks `receiverBase`.
3. **Cumulative ACK:** Accepting in-order frame $k$ delivers it and returns cumulative `ACK k`.
4. **Out-of-Order Discard:** Any frame $\neq receiverBase$ is strictly discarded; a duplicate cumulative ACK for $(receiverBase - 1)$ is re-sent.
5. **Single Timer:** Exactly one timer runs for the oldest unacknowledged packet ($S_{\text{base}}$). On timeout, all unacknowledged frames in the window are retransmitted sequentially with 250ms stagger.

### Selective Repeat (SR)
1. **Windows:** $W_s = N$ and $W_r = N$.
2. **Receiver Buffering:** Out-of-order frames within the receive window are stored in the buffer (`BUFFERED` status) and elicit individual selective ACKs.
3. **Atomic Delivery:** When $R_{\text{base}}$ arrives, $R_{\text{base}}$ and all adjacent buffered frames are delivered to the upper layer, and $R_{\text{base}}$ slides forward past the delivered range.
4. **Independent Timers:** Each in-flight frame has an independent timer. On timeout, only the timed-out frame is retransmitted.

---

## 5. Reliable Fault Injection Mechanics

- **Drop Next Frame:** Toggling arms `pendingDropFrameRef`. When the next data packet is dispatched, it is flagged (`isLost = true`), crosses out with `scale-90 opacity-0`, and is dropped in transit.
- **Drop Next ACK:** Toggling arms `pendingDropAckRef`. When the receiver generates the next ACK (whether cumulative, duplicate, or selective), it is flagged (`isLost = true`), crosses out with `scale-90 opacity-0`, and is dropped in transit before reaching the sender.
- **Click-to-Drop:** Clicking any in-flight data pill (`PKT k` or `ACK k`) instantly drops it mid-channel.

---

## 6. Viva Examination Q&A Reference

### Q1: Why does Go-Back-N require cumulative ACKs while Selective Repeat uses selective ACKs?
**Answer:**  
In GBN, the receiver window size is 1 ($W_r = 1$); out-of-order frames are never buffered. An acknowledgment for frame $n$ guarantees that all preceding frames were received in strict order. In SR, the receiver buffers out-of-order frames within its window of size $N$, creating gaps. The sender must know precisely which packets arrived to avoid unnecessary retransmissions.

### Q2: What is the sequence number requirement for GBN and SR?
**Answer:**  
- **GBN:** $N \le 2^k - 1$ (where $k$ is the sequence number bit length).
- **SR:** $W_s + W_r \le 2^k \implies N \le 2^{k-1}$ when $W_s = W_r = N$.

### Q3: How is protocol efficiency calculated?
**Answer:**  
$$\text{Efficiency } (\%) = \left( \frac{\text{Total Delivered Frames}}{\text{Total Transmitted Frames (Original + Retransmissions)}} \right) \times 100$$
- In error-free transmission, efficiency is $100\%$.
- When frames are lost, GBN efficiency drops significantly because the entire unacknowledged window is retransmitted, whereas SR retransmits only the single lost frame.
