# Sliding Window Protocol Simulator (Go-Back-N & Selective Repeat)

An interactive, high-performance network protocol engineering console built with React, TypeScript, and Tailwind CSS. Designed after standard academic simulation models (TU Berlin / Johannes Kessler), this visualizer accurately simulates Data Link and Transport Layer sliding window flow control mechanics, pipeline dynamics, cumulative vs. selective acknowledgments, and fault recovery.

---

## ⚡ Key Highlights & Mechanics

- **Go-Back-N (GBN) State Engine:**
  - Strict in-order receiver processing ($W_r = 1$) with discard of out-of-order frames.
  - Cumulative acknowledgments ($ACK\ k$ confirms all frames through $k$).
  - Single-window base timer ($S_{\text{base}}$) countdown visualization embedded directly inside frame badges.
  - Complete window $[S_{\text{base}} \dots S_{\text{base}} + N - 1]$ retransmission upon timeout.

- **Selective Repeat (SR) State Engine:**
  - Independent sender window ($W_s = N$) and receiver buffer window ($W_r = N$).
  - Receiver-side out-of-order frame buffering and atomic contiguous delivery upon arrival of base frames.
  - Individual packet-level timers and isolated retransmissions for lost segments only.

- **Interactive Channel Highway & Fault Injection:**
  - Bidirectional visual highway: outbound data frames traveling downward and inbound ACKs propagating upward.
  - On-demand runtime fault injection: drop next data frame, drop next ACK, or hover-to-kill active in-flight packets.
  - Hardware-accelerated CSS translation transitions maintaining a stable 60 FPS without React render cycle lag.

- **Diagnostic Telemetry HUD:**
  - Real-time protocol metrics: Total Packets Sent, Delivered, Retransmission Count, and Network Efficiency ($\frac{\text{Delivered}}{\text{Sent}} \times 100$).
  - Color-coded, auto-scrolling monospace event log stream tracking transmission, delivery, drops, and timeouts.
  - Fine-grained controls: variable window size ($N \in [2, 8]$), inter-packet speed ($0.5\times, 1\times, 2\times$), timeout intervals, and step-by-step tick execution for viva demonstrations.

---

## 🛠️ Tech Stack & Standards

- **Frontend & Visuals:** React 18, TypeScript (Strict Mode), Vite, Tailwind CSS
- **Design Aesthetic:** Industrial dark-mode engineering console (`zinc-950`), custom SVG countdown meters, monospace data grids
- **Academic Deliverables:** 
  - Complete standalone reference simulator in ANSI C (`gbn_sr.c`)
  - Formal protocol proofs ($W < 2^k$ for GBN, $W_s + W_r \le 2^k$ for SR) and state machine specifications (`PROJECT_ARCHITECTURE.md`)