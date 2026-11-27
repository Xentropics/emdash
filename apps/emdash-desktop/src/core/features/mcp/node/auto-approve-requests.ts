import { randomUUID } from 'node:crypto';
import { type LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose, peek, type Cell } from '@emdash/wire/state';
import { mcpContract, type AutoApproveRequest } from '../api';

/** How long a request waits for the user before it counts as denied. */
export const AUTO_APPROVE_REQUEST_TIMEOUT_MS = 2 * 60_000;

export type AutoApproveRequestInput = Omit<AutoApproveRequest, 'id'>;

export type AutoApproveRequestsOptions = Readonly<{
  timeoutMs?: number;
  /** Brings the app window forward so the user sees the request. */
  reveal?: () => void;
}>;

/**
 * Pending auto-approve requests from MCP clients. Each request waits until the
 * user answers it in the app, and counts as denied when it times out or Emdash
 * shuts down: an MCP client can never turn auto-approve on by itself.
 *
 * The queue is a live state rather than an event, so a renderer that starts (or
 * reloads) while a request is waiting still shows it.
 */
export class AutoApproveRequests {
  readonly pending: Cell<AutoApproveRequest[]>;
  readonly host: LeasedLiveModelProvider<typeof mcpContract.autoApproveRequests>;
  private readonly waiting = new Map<
    string,
    { settle: (allow: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(private readonly options: AutoApproveRequestsOptions = {}) {
    this.pending = cell<AutoApproveRequest[]>([]);
    this.host = expose(mcpContract.autoApproveRequests, { pending: this.pending });
  }

  /** Resolves true only when the user allows the request. */
  request(input: AutoApproveRequestInput): Promise<boolean> {
    const request: AutoApproveRequest = { ...input, id: randomUUID() };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => this.resolve(request.id, false),
        this.options.timeoutMs ?? AUTO_APPROVE_REQUEST_TIMEOUT_MS
      );
      this.waiting.set(request.id, { settle: resolve, timer });
      this.pending.set([...peek(this.pending), request]);
      this.options.reveal?.();
    });
  }

  resolve(id: string, allow: boolean): void {
    const entry = this.waiting.get(id);
    if (!entry) return;
    this.waiting.delete(id);
    clearTimeout(entry.timer);
    this.pending.set(peek(this.pending).filter((request) => request.id !== id));
    entry.settle(allow);
  }

  /** Denies every waiting request, e.g. when the MCP server stops. */
  denyAll(): void {
    for (const id of [...this.waiting.keys()]) this.resolve(id, false);
  }

  dispose(): void {
    this.denyAll();
    void this.host.dispose();
  }
}
