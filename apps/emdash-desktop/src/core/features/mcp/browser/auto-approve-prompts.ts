import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire/state';
import { openModal } from '@core/manifests/browser/modal-api';
import { modalStore } from '@core/primitives/modals/react/modal-store';
import { mcpContract, type AutoApproveRequest } from '../api';
import { getMcpClient, type McpRpcClient } from '../api/browser/client';

/**
 * Shows each auto-approve request from an MCP client as a confirmation modal,
 * one at a time, and sends the user's answer back. Closing the modal denies the
 * request. A request that disappears while shown (it timed out in the main
 * process) closes its modal.
 */
export class McpAutoApprovePrompts {
  private scope: Scope | null = null;
  private client: McpRpcClient | null = null;
  private readonly seen = new Set<string>();
  private queue: AutoApproveRequest[] = [];
  private showing: { id: string; modalKey: number | null } | null = null;
  private stopped = false;

  constructor(private readonly clientFactory: () => Promise<McpRpcClient> = getMcpClient) {}

  async start(): Promise<void> {
    const client = await this.clientFactory();
    if (this.stopped) return;
    this.client = client;
    const scope = createScope({ label: 'mcp:auto-approve-prompts' });
    this.scope = scope;
    const model = remote(mcpContract.autoApproveRequests, client.autoApproveRequests, {
      scope,
      lingerMs: 15_000,
    })(undefined);
    observe(model.states.pending, (snapshot) => this.sync(snapshot.value ?? []), { scope });
  }

  dispose(): void {
    this.stopped = true;
    void this.scope?.dispose();
    this.scope = null;
  }

  private sync(pending: readonly AutoApproveRequest[]): void {
    const ids = new Set(pending.map((request) => request.id));
    this.queue = this.queue.filter((request) => ids.has(request.id));
    for (const request of pending) {
      if (this.seen.has(request.id)) continue;
      this.seen.add(request.id);
      this.queue.push(request);
    }
    for (const id of this.seen) if (!ids.has(id) && this.showing?.id !== id) this.seen.delete(id);
    if (this.showing && !ids.has(this.showing.id) && this.showing.modalKey !== null) {
      modalStore.dismissEntry(this.showing.modalKey);
    }
    void this.showNext();
  }

  private async showNext(): Promise<void> {
    if (this.showing || this.stopped) return;
    const request = this.queue.shift();
    if (!request) return;
    this.showing = { id: request.id, modalKey: null };
    const answer = openModal('confirmActionModal', {
      title: describeTitle(request),
      description: describeRequest(request),
      confirmLabel: request.enable ? 'Allow auto-approve' : 'Turn off auto-approve',
      variant: request.enable ? 'destructive' : 'default',
    });
    this.showing.modalKey = modalStore.stack.at(-1)?.key ?? null;
    const result = await answer;
    this.showing = null;
    this.seen.delete(request.id);
    try {
      await this.client?.resolveAutoApproveRequest({ id: request.id, allow: result.success });
    } finally {
      void this.showNext();
    }
  }
}

function describeTitle(request: AutoApproveRequest): string {
  if (request.kind === 'create') return 'Start an agent with auto-approve?';
  return request.enable ? 'Turn on auto-approve?' : 'Turn off auto-approve?';
}

export function describeRequest(request: AutoApproveRequest): string {
  const agent = request.providerName ?? 'The agent';
  const where = request.projectName
    ? `task "${request.taskName}" in ${request.projectName}`
    : `task "${request.taskName}"`;
  const effect = request.enable
    ? 'run commands and edit files without asking you first'
    : 'ask you again before running commands and editing files';
  const restart = request.restartsAgent
    ? ' The agent restarts and resumes its session to apply this.'
    : '';
  return (
    `A tool connected to Emdash over MCP asks to let ${agent} in ${where} ${effect}.` + restart
  );
}
