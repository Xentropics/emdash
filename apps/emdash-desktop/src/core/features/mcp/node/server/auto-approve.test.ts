import { ok } from '@emdash/shared';
import { cell } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { conversationRegistryTable } from '@core/features/conversations/api/node/registry';
import { projects } from '@core/services/app-db/node/schema';
import { setConversationAutoApprove } from './auto-approve';
import type { McpToolDependencies } from './dependencies';

type ConversationRow = {
  id: string;
  provider: string | null;
  type: 'pty' | 'acp';
  agentStatus: string | null;
  lastSessionActivityAt: string | null;
  updatedAt: string;
  config: Record<string, unknown>;
};

const TASK = {
  id: 'task-1',
  name: 'Fix the bug',
  status: 'in_progress',
  archivedAt: null,
  workspaceId: 'workspace-1',
};

function ptyConversation(autoApprove: boolean): ConversationRow {
  return {
    id: 'conv-pty',
    provider: 'claude',
    type: 'pty',
    agentStatus: 'idle',
    lastSessionActivityAt: null,
    updatedAt: '2026-11-05 09:00:00',
    config: { type: 'pty', autoApprove },
  };
}

function fakeDb(conversations: ConversationRow[]) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const rows =
          table === conversationRegistryTable
            ? conversations
            : table === projects
              ? [{ name: 'Repo' }]
              : [TASK];
        const chain = {
          where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return chain;
      },
    }),
  };
}

function setup(options: { conversations?: ConversationRow[]; running?: boolean; allow?: boolean }) {
  const conversations = options.conversations ?? [ptyConversation(false)];
  // The host record is mirrored into the app's row; the fake applies it at once.
  const patchConfig = vi.fn(
    async (input: { conversationId: string; patch: Record<string, unknown> }) => {
      const row = conversations.find((conversation) => conversation.id === input.conversationId);
      if (row) row.config = { ...row.config, ...input.patch };
      return ok({ record: {}, skippedKeys: [] });
    }
  );
  const confirmAutoApprove = vi.fn(async () => options.allow ?? true);
  const restartConversation = vi.fn(async () => ({ restarted: true }));
  const client = {
    conversations: { patchConfig },
    tuiAgents: {
      sessions: {
        state: () => ({
          snapshot: async () => ({
            data: options.running ? { 'conv-pty': { status: 'running' } } : {},
          }),
        }),
      },
    },
  };
  const deps = {
    db: fakeDb(conversations),
    runtimes: { client: async () => ok(client) },
    workspaceIdentity: {
      resolve: async () => ({ host: { type: 'local', id: 'local' }, path: '/worktrees/task-1' }),
    },
    projects: { track: () => cell({ kind: 'attached' }), requireAttached: () => ok({}) },
    logger: { warn: () => {} },
    confirmAutoApprove,
    restartConversation,
  } as unknown as McpToolDependencies;
  return { deps, patchConfig, confirmAutoApprove, restartConversation };
}

const base = { projectId: 'project-1', taskId: 'task-1' };

describe('setConversationAutoApprove', () => {
  it('saves the change for a stopped agent after the user allows it', async () => {
    const { deps, patchConfig, confirmAutoApprove, restartConversation } = setup({});

    const result = await setConversationAutoApprove(deps, { ...base, enabled: true });

    expect(result).toEqual(
      ok({ conversationId: 'conv-pty', autoApprove: true, changed: true, restarted: false })
    );
    expect(confirmAutoApprove).toHaveBeenCalledWith({
      kind: 'change',
      enable: true,
      taskName: 'Fix the bug',
      projectName: 'Repo',
      providerName: 'Claude Code',
      restartsAgent: false,
    });
    expect(patchConfig).toHaveBeenCalledWith({
      conversationId: 'conv-pty',
      patch: { autoApprove: true },
    });
    expect(restartConversation).not.toHaveBeenCalled();
  });

  it('restarts a running agent so the change takes effect', async () => {
    const { deps, confirmAutoApprove, restartConversation } = setup({ running: true });

    const result = await setConversationAutoApprove(deps, { ...base, enabled: true });

    expect(result).toMatchObject({ success: true, data: { changed: true, restarted: true } });
    expect(confirmAutoApprove).toHaveBeenCalledWith(
      expect.objectContaining({ restartsAgent: true })
    );
    expect(restartConversation).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conv-pty',
    });
  });

  it('asks before turning auto-approve off too', async () => {
    const { deps, confirmAutoApprove } = setup({ conversations: [ptyConversation(true)] });

    const result = await setConversationAutoApprove(deps, { ...base, enabled: false });

    expect(result).toMatchObject({ success: true, data: { autoApprove: false, changed: true } });
    expect(confirmAutoApprove).toHaveBeenCalledWith(expect.objectContaining({ enable: false }));
  });

  it('changes nothing when the user denies it', async () => {
    const { deps, patchConfig, restartConversation } = setup({ allow: false, running: true });

    const result = await setConversationAutoApprove(deps, { ...base, enabled: true });

    expect(result).toEqual({
      success: false,
      error: 'The user did not allow turning auto-approve on in Emdash',
    });
    expect(patchConfig).not.toHaveBeenCalled();
    expect(restartConversation).not.toHaveBeenCalled();
  });

  it('does not ask when the conversation already has the requested setting', async () => {
    const { deps, confirmAutoApprove } = setup({ conversations: [ptyConversation(true)] });

    const result = await setConversationAutoApprove(deps, { ...base, enabled: true });

    expect(result).toMatchObject({ success: true, data: { changed: false, restarted: false } });
    expect(confirmAutoApprove).not.toHaveBeenCalled();
  });

  it('refuses chat UI conversations', async () => {
    const acp: ConversationRow = {
      ...ptyConversation(false),
      id: 'conv-acp',
      type: 'acp',
      config: { type: 'acp' },
    };
    const { deps, confirmAutoApprove } = setup({ conversations: [acp] });

    const result = await setConversationAutoApprove(deps, {
      ...base,
      enabled: true,
      conversationId: 'conv-acp',
    });

    expect(result.success).toBe(false);
    expect(confirmAutoApprove).not.toHaveBeenCalled();
  });
});
