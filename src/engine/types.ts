export type ProtocolType = 'gbn' | 'sr';

export type FrameStatus =
  | 'unsent'
  | 'in-flight'
  | 'acked'
  | 'dropped'
  | 'timeout';

export type ReceiverSlotState =
  | 'empty'
  | 'buffered'
  | 'delivered';

export interface SimConfig {
  protocol: ProtocolType;
  /** Window size N (between 2 and 8) */
  windowSize: number;
  /** Total frames to transmit (10 to 20) */
  totalPackets: number;
  /** Timeout duration in seconds */
  timeoutDuration: number;
  /** One-way propagation delay in seconds */
  propagationDelay: number;
  /** Transmission stagger interval in ms between consecutive pipeline frames (e.g. 250ms) */
  staggerMs: number;
  /** Animation speed multiplier */
  animationSpeed: number;
}

export interface InFlightPacket {
  id: string;
  seq: number;
  type: 'DATA' | 'ACK';
  isRetransmission?: boolean;
  isLost?: boolean;
  isCumulative?: boolean;
  slotIndex: number;
  createdAt: number;
  durationMs: number;
}

export interface SenderSlot {
  seq: number;
  status: FrameStatus;
  /** Timestamp when timer started */
  timerStart: number | null;
  /** Flash timeout warning until this timestamp */
  timeoutFlashUntil: number | null;
}

export interface ReceiverSlot {
  seq: number;
  state: ReceiverSlotState;
}

export interface LogEntry {
  id: string;
  time: number;
  tag: 'TX' | 'RX' | 'ACK_TX' | 'ACK_RX' | 'DROP' | 'TIMEOUT' | 'SLIDE' | 'BUFFER' | 'DELIVER' | 'RETX';
  message: string;
}

export interface SimState {
  simTime: number;
  senderBase: number;
  nextSeqNum: number;
  receiverBase: number;
  senderSlots: Map<number, SenderSlot>;
  receiverSlots: Map<number, ReceiverSlot>;
  activePackets: InFlightPacket[];
  log: LogEntry[];
  /** GBN: single timer for oldest unacknowledged packet */
  gbnTimerStart: number | null;
  gbnTimeoutFlashUntil: number | null;
  /** Telemetry counters */
  totalSent: number;
  totalRetransmissions: number;
  totalDelivered: number;
  /** Fault injection triggers */
  pendingDropFrame: boolean;
  pendingDropAck: boolean;
  /** Completion flag */
  isComplete: boolean;
}

export const DEFAULT_CONFIG: SimConfig = {
  protocol: 'gbn',
  windowSize: 4,
  totalPackets: 12,
  timeoutDuration: 5.0,
  propagationDelay: 2.0,
  staggerMs: 250,
  animationSpeed: 1.0,
};

let _idCounter = 0;
export function uid(prefix: string): string {
  return `${prefix}-${++_idCounter}`;
}

export function resetUidCounter(): void {
  _idCounter = 0;
}
