/**
 * @file gbn_sr.c
 * @brief Sliding Window Protocol Simulator (Go-Back-N and Selective Repeat)
 *
 * Implements discrete-event simulation of both Go-Back-N (GBN) and
 * Selective Repeat (SR) protocols with pipelining, fault injection
 * (frame/ACK drop), window sliding, and performance metrics telemetry.
 *
 * Standard: ANSI C / C99 / C11
 * Compilation: gcc -Wall -Wextra -O2 gbn_sr.c -o gbn_sr
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>

#define MAX_FRAMES 64
#define DEFAULT_WINDOW_SIZE 4
#define DEFAULT_TOTAL_FRAMES 10
#define TIMEOUT_TICKS 5

/* ========================================================================= */
/* DATA STRUCTURES                                                           */
/* ========================================================================= */

typedef enum {
    FRAME_UNSENT,
    FRAME_IN_FLIGHT,
    FRAME_ACKED,
    FRAME_LOST
} FrameState;

typedef struct {
    int seq_num;
    FrameState state;
    int timer;          /* Countdown ticks for timeout in SR */
    int transmit_count; /* Number of transmission attempts */
} SenderFrame;

typedef struct {
    bool received;      /* Whether slot has been received */
    bool delivered;     /* Whether delivered to upper layer */
} ReceiverSlot;

typedef struct {
    int total_sent;
    int total_retransmitted;
    int total_delivered;
    int timeouts;
} ProtocolMetrics;

/* ========================================================================= */
/* FUNCTION PROTOTYPES                                                       */
/* ========================================================================= */

void run_go_back_n(int window_size, int total_frames, double loss_prob);
void run_selective_repeat(int window_size, int total_frames, double loss_prob);
void print_banner(const char *title);
void print_metrics(const ProtocolMetrics *m, int total_frames);

/* ========================================================================= */
/* GO-BACK-N (GBN) SIMULATION                                                */
/* ========================================================================= */

void run_go_back_n(int window_size, int total_frames, double loss_prob) {
    print_banner("SIMULATING GO-BACK-N (GBN) PROTOCOL");
    printf("[CONFIG] Window Size (N): %d | Total Frames: %d | Loss Probability: %.2f\n\n",
           window_size, total_frames, loss_prob);

    SenderFrame sender[MAX_FRAMES];
    for (int i = 0; i < total_frames; i++) {
        sender[i].seq_num = i;
        sender[i].state = FRAME_UNSENT;
        sender[i].timer = 0;
        sender[i].transmit_count = 0;
    }

    int sender_base = 0;
    int next_seq_num = 0;
    int expected_seq_num = 0;
    int gbn_timer = 0;
    bool timer_running = false;

    ProtocolMetrics metrics = {0, 0, 0, 0};

    int current_tick = 0;
    while (sender_base < total_frames && current_tick < 1000) {
        current_tick++;
        printf("--- [TICK %02d] Sender Window: [%d .. %d] | Expected: %d ---\n",
               current_tick, sender_base,
               (sender_base + window_size - 1 < total_frames) ? sender_base + window_size - 1 : total_frames - 1,
               expected_seq_num);

        /* 1. SENDER: Transmit new frames within window */
        while (next_seq_num < sender_base + window_size && next_seq_num < total_frames) {
            sender[next_seq_num].state = FRAME_IN_FLIGHT;
            sender[next_seq_num].transmit_count++;
            metrics.total_sent++;

            if (!timer_running) {
                gbn_timer = TIMEOUT_TICKS;
                timer_running = true;
            }

            /* Simulate channel drop */
            bool dropped = ((double)rand() / RAND_MAX) < loss_prob;
            if (dropped) {
                printf("  [SENDER TX] Frame %d transmitted -> (LOST in channel!)\n", next_seq_num);
            } else {
                printf("  [SENDER TX] Frame %d transmitted -> Receiver\n", next_seq_num);

                /* 2. RECEIVER: Strict in-order processing */
                if (next_seq_num == expected_seq_num) {
                    printf("    [RECEIVER RX] Frame %d accepted (in-order). Cumulative ACK %d sent.\n",
                           next_seq_num, expected_seq_num);
                    expected_seq_num++;
                    metrics.total_delivered++;

                    /* Receiver ACK travels back */
                    bool ack_dropped = ((double)rand() / RAND_MAX) < (loss_prob * 0.5);
                    if (ack_dropped) {
                        printf("      [ACK TX] Cumulative ACK %d -> (LOST in reverse channel!)\n", next_seq_num);
                    } else {
                        printf("      [SENDER RX] Cumulative ACK %d received. Window slides.\n", next_seq_num);
                        for (int k = sender_base; k <= next_seq_num; k++) {
                            sender[k].state = FRAME_ACKED;
                        }
                        sender_base = next_seq_num + 1;
                        if (sender_base == next_seq_num + 1 && sender_base < next_seq_num) {
                            gbn_timer = TIMEOUT_TICKS;
                        } else if (sender_base == next_seq_num + 1) {
                            timer_running = false;
                        }
                    }
                } else {
                    /* Out-of-order frame: discarded */
                    printf("    [RECEIVER RX] Frame %d DISCARDED (out-of-order, expected %d). Resending ACK %d.\n",
                           next_seq_num, expected_seq_num, expected_seq_num - 1);
                }
            }
            next_seq_num++;
        }

        /* 3. SENDER: Timer countdown & Go-Back-N timeout */
        if (timer_running) {
            gbn_timer--;
            if (gbn_timer <= 0) {
                printf("  [TIMEOUT ALERT] Sender timer expired for Frame %d! Retransmitting ALL frames [%d .. %d]...\n",
                       sender_base, sender_base, next_seq_num - 1);
                metrics.timeouts++;

                /* Go-Back-N: Reset next_seq_num back to sender_base */
                for (int i = sender_base; i < next_seq_num; i++) {
                    metrics.total_retransmitted++;
                }
                next_seq_num = sender_base;
                gbn_timer = TIMEOUT_TICKS;
            }
        }
    }

    print_metrics(&metrics, total_frames);
}

/* ========================================================================= */
/* SELECTIVE REPEAT (SR) SIMULATION                                          */
/* ========================================================================= */

void run_selective_repeat(int window_size, int total_frames, double loss_prob) {
    print_banner("SIMULATING SELECTIVE REPEAT (SR) PROTOCOL");
    printf("[CONFIG] Window Size (N): %d | Total Frames: %d | Loss Probability: %.2f\n\n",
           window_size, total_frames, loss_prob);

    SenderFrame sender[MAX_FRAMES];
    ReceiverSlot receiver[MAX_FRAMES];

    for (int i = 0; i < total_frames; i++) {
        sender[i].seq_num = i;
        sender[i].state = FRAME_UNSENT;
        sender[i].timer = 0;
        sender[i].transmit_count = 0;

        receiver[i].received = false;
        receiver[i].delivered = false;
    }

    int sender_base = 0;
    int next_seq_num = 0;
    int receiver_base = 0;

    ProtocolMetrics metrics = {0, 0, 0, 0};
    int current_tick = 0;

    while (sender_base < total_frames && current_tick < 1000) {
        current_tick++;
        printf("--- [TICK %02d] Sender Base: %d | Receiver Base: %d ---\n",
               current_tick, sender_base, receiver_base);

        /* 1. SENDER: Emit frames within sender window */
        while (next_seq_num < sender_base + window_size && next_seq_num < total_frames) {
            sender[next_seq_num].state = FRAME_IN_FLIGHT;
            sender[next_seq_num].timer = TIMEOUT_TICKS;
            sender[next_seq_num].transmit_count++;
            metrics.total_sent++;

            bool dropped = ((double)rand() / RAND_MAX) < loss_prob;
            if (dropped) {
                printf("  [SENDER TX] Frame %d transmitted -> (LOST in channel!)\n", next_seq_num);
            } else {
                printf("  [SENDER TX] Frame %d transmitted -> Receiver\n", next_seq_num);

                /* 2. RECEIVER: Accept frames within receiver window */
                if (next_seq_num >= receiver_base && next_seq_num < receiver_base + window_size) {
                    receiver[next_seq_num].received = true;

                    if (next_seq_num == receiver_base) {
                        printf("    [RECEIVER RX] Base Frame %d received! Delivering contiguously...\n", next_seq_num);
                        /* Deliver base and any contiguously buffered frames */
                        while (receiver_base < total_frames && receiver[receiver_base].received) {
                            receiver[receiver_base].delivered = true;
                            metrics.total_delivered++;
                            printf("      [DELIVERED] Frame %d passed to application layer.\n", receiver_base);
                            receiver_base++;
                        }
                    } else {
                        printf("    [RECEIVER RX] Out-of-order Frame %d BUFFERED in receiver window.\n", next_seq_num);
                    }

                    /* Send Individual Selective ACK */
                    bool ack_dropped = ((double)rand() / RAND_MAX) < (loss_prob * 0.5);
                    if (ack_dropped) {
                        printf("      [ACK TX] Individual ACK %d -> (LOST in reverse channel!)\n", next_seq_num);
                    } else {
                        printf("      [SENDER RX] Individual ACK %d received for Frame %d.\n", next_seq_num, next_seq_num);
                        sender[next_seq_num].state = FRAME_ACKED;
                        sender[next_seq_num].timer = 0;

                        /* Slide sender base past contiguously ACKed frames */
                        while (sender_base < total_frames && sender[sender_base].state == FRAME_ACKED) {
                            sender_base++;
                            printf("        [WINDOW SLIDE] Sender base advanced to %d.\n", sender_base);
                        }
                    }
                }
            }
            next_seq_num++;
        }

        /* 3. SENDER: Independent per-packet timers check */
        for (int i = sender_base; i < next_seq_num; i++) {
            if (sender[i].state == FRAME_IN_FLIGHT) {
                sender[i].timer--;
                if (sender[i].timer <= 0) {
                    printf("  [TIMEOUT ALERT] Timer expired for Frame %d ONLY! Retransmitting selectively...\n", i);
                    metrics.timeouts++;
                    metrics.total_retransmitted++;
                    metrics.total_sent++;
                    sender[i].timer = TIMEOUT_TICKS;
                    sender[i].transmit_count++;

                    /* Attempt retransmission */
                    bool dropped = ((double)rand() / RAND_MAX) < loss_prob;
                    if (dropped) {
                        printf("    [RETX LOST] Frame %d retransmission dropped!\n", i);
                    } else {
                        printf("    [RETX SUCCESS] Frame %d arrived at receiver.\n", i);
                        receiver[i].received = true;
                        if (i == receiver_base) {
                            while (receiver_base < total_frames && receiver[receiver_base].received) {
                                receiver[receiver_base].delivered = true;
                                metrics.total_delivered++;
                                receiver_base++;
                            }
                        }
                        sender[i].state = FRAME_ACKED;
                        sender[i].timer = 0;
                        while (sender_base < total_frames && sender[sender_base].state == FRAME_ACKED) {
                            sender_base++;
                        }
                    }
                }
            }
        }
    }

    print_metrics(&metrics, total_frames);
}

/* ========================================================================= */
/* UTILITY & TELEMETRY DISPLAY                                               */
/* ========================================================================= */

void print_banner(const char *title) {
    printf("\n======================================================================\n");
    printf("  %s\n", title);
    printf("======================================================================\n");
}

void print_metrics(const ProtocolMetrics *m, int total_frames) {
    double efficiency = (m->total_sent > 0) ? ((double)total_frames / m->total_sent) * 100.0 : 0.0;

    printf("\n----------------------------------------------------------------------\n");
    printf("  SIMULATION PERFORMANCE TELEMETRY\n");
    printf("----------------------------------------------------------------------\n");
    printf("  Original Frames to Send : %d\n", total_frames);
    printf("  Total Frames Transmitted: %d\n", m->total_sent);
    printf("  Retransmissions         : %d\n", m->total_retransmitted);
    printf("  Timeout Events          : %d\n", m->timeouts);
    printf("  Successfully Delivered  : %d\n", m->total_delivered);
    printf("  Protocol Efficiency     : %.2f%%\n", efficiency);
    printf("----------------------------------------------------------------------\n\n");
}

/* ========================================================================= */
/* MAIN ENTRY POINT                                                          */
/* ========================================================================= */

int main(void) {
    srand((unsigned int)time(NULL));

    printf("======================================================================\n");
    printf("       COMPUTER NETWORKS: SLIDING WINDOW SIMULATOR (GBN & SR)         \n");
    printf("======================================================================\n");
    printf("Select Protocol to Simulate:\n");
    printf("  1. Go-Back-N (GBN)\n");
    printf("  2. Selective Repeat (SR)\n");
    printf("  3. Run Both with Comparison\n");
    printf("  4. Exit\n");
    printf("Enter choice (1-4): ");

    int choice = 3;
    /* Allow non-interactive piped execution or standard input */
    if (scanf("%d", &choice) != 1) {
        choice = 3; /* Default to comparison if EOF */
    }

    int window_size = DEFAULT_WINDOW_SIZE;
    int total_frames = DEFAULT_TOTAL_FRAMES;
    double loss_prob = 0.25; /* 25% drop rate for demonstrating recovery */

    switch (choice) {
        case 1:
            run_go_back_n(window_size, total_frames, loss_prob);
            break;
        case 2:
            run_selective_repeat(window_size, total_frames, loss_prob);
            break;
        case 3:
            run_go_back_n(window_size, total_frames, loss_prob);
            run_selective_repeat(window_size, total_frames, loss_prob);
            break;
        case 4:
            printf("Exiting simulator.\n");
            break;
        default:
            printf("Invalid selection. Defaulting to comparative simulation.\n");
            run_go_back_n(window_size, total_frames, loss_prob);
            run_selective_repeat(window_size, total_frames, loss_prob);
            break;
    }

    return 0;
}
