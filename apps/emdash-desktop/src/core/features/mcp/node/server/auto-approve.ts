import { err, ok, type Result } from '@emdash/shared';
import { eq } from 'drizzle-orm';
import { getPlugin, isValidProviderId } from '@core/features/agents/api/node/plugin-registry';
import { conversationRegistryTable as conversations } from '@core/features/conversations/api/node/registry';
import { projects } from '@core/services/app-db/node/schema';
import { withProjectAttachment } from './attach-project';
import type { McpToolDependencies } from './dependencies';
import { findTask, listTaskConversations, resolveTaskClient } from './task-conversation';

/** How long to wait for the app's copy of the conversation to pick up the new config. */
const MIRROR_WAIT_MS = 5_000;
const MIRROR_POLL_MS = 100;

export async function findProjectName(
  dependencies: Pick<McpToolDependencies, 'db'>,
  projectId: string
): Promise<string | null> {
  const [row] = await dependencies.db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.name ?? null;
}

export function providerDisplayName(provider: string | null): string | null {
  if (!provider) return null;
  return isValidProviderId(provider) ? getPlugin(provider).metadata.name : provider;
}

export type SetAutoApproveInput = {
  projectId: string;
  taskId: string;
  enabled: boolean;
  conversationId?: string;
};

export type SetAutoApproveResult = {
  conversationId: string;
  autoApprove: boolean;
  /** False when the setting already had the requested value. */
  changed: boolean;
  /** True when the running agent was restarted so the change takes effect now. */
  restarted: boolean;
  /** Set when the change is saved but the running agent could not be restarted. */
  warning?: string;
};

/**
 * Turns auto-approve on or off for one terminal conversation, after the user
 * allows it in the app. A running agent is stopped and launched again with the
 * new setting, resuming its session; a stopped one picks it up on its next start.
 */
export async function setConversationAutoApprove(
  dependencies: McpToolDependencies,
  input: SetAutoApproveInput
): Promise<Result<SetAutoApproveResult, string>> {
  const task = await findTask(dependencies, input);
  if (!task.success) return task;
  if (task.data.archivedAt) {
    return err(`Task ${input.taskId} is archived; restore it in Emdash first`);
  }

  const taskConversations = await listTaskConversations(dependencies, input);
  const conversation = input.conversationId
    ? taskConversations.find((candidate) => candidate.id === input.conversationId)
    : taskConversations.find((candidate) => candidate.type === 'pty');
  if (!conversation) {
    return err(
      input.conversationId
        ? `Conversation ${input.conversationId} not found in task ${input.taskId}`
        : `Task ${input.taskId} has no terminal agent conversation`
    );
  }
  if (conversation.type !== 'pty') {
    return err(
      'Auto-approve applies to terminal conversations only; chat UI agents use their own ' +
        'permission settings'
    );
  }
  if (
    !conversation.provider ||
    !isValidProviderId(conversation.provider) ||
    getPlugin(conversation.provider).capabilities.autoApprove.kind !== 'supported'
  ) {
    return err(`Provider "${conversation.provider ?? 'unknown'}" has no auto-approve mode`);
  }

  const current = await readAutoApprove(dependencies, conversation.id);
  if (current === input.enabled) {
    return ok({
      conversationId: conversation.id,
      autoApprove: current,
      changed: false,
      restarted: false,
    });
  }

  const client = await resolveTaskClient(dependencies, task.data);
  if (!client.success) return client;
  const sessions = await client.data.tuiAgents.sessions.state(undefined, 'list').snapshot();
  const running = sessions.data[conversation.id]?.status === 'running';

  const allowed = await dependencies.confirmAutoApprove({
    kind: 'change',
    enable: input.enabled,
    taskName: task.data.name,
    projectName: await findProjectName(dependencies, input.projectId),
    providerName: providerDisplayName(conversation.provider),
    restartsAgent: running,
  });
  if (!allowed) {
    return err(
      `The user did not allow turning auto-approve ${input.enabled ? 'on' : 'off'} in Emdash`
    );
  }

  const patched = await client.data.conversations.patchConfig({
    conversationId: conversation.id,
    patch: { autoApprove: input.enabled },
  });
  if (!patched.success) {
    return err(`Could not save the setting: ${patched.error.message ?? patched.error.type}`);
  }
  const result: SetAutoApproveResult = {
    conversationId: conversation.id,
    autoApprove: input.enabled,
    changed: true,
    restarted: false,
  };
  if (!running) return ok(result);

  // The launch reads the app's copy of the conversation, which follows the host's
  // record asynchronously: wait for it so the agent starts with the new setting.
  if (!(await waitForMirror(dependencies, conversation.id, input.enabled))) {
    return ok({
      ...result,
      warning: 'The setting is saved, but the agent was not restarted. Restart it in Emdash.',
    });
  }
  const restarted = await withProjectAttachment(dependencies.projects, input.projectId, async () =>
    ok(
      await dependencies.restartConversation({
        projectId: input.projectId,
        taskId: input.taskId,
        conversationId: conversation.id,
      })
    )
  );
  if (!restarted.success) return ok({ ...result, warning: restarted.error });
  return ok(
    restarted.data.restarted
      ? { ...result, restarted: true }
      : {
          ...result,
          warning: `The setting is saved, but the agent did not restart${
            restarted.data.message ? `: ${restarted.data.message}` : ''
          }`,
        }
  );
}

async function readAutoApprove(
  dependencies: Pick<McpToolDependencies, 'db'>,
  conversationId: string
): Promise<boolean> {
  const [row] = await dependencies.db
    .select({ config: conversations.config })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const config = row?.config;
  return config?.type === 'pty' && config.autoApprove === true;
}

async function waitForMirror(
  dependencies: Pick<McpToolDependencies, 'db'>,
  conversationId: string,
  expected: boolean
): Promise<boolean> {
  const deadline = Date.now() + MIRROR_WAIT_MS;
  while (Date.now() < deadline) {
    if ((await readAutoApprove(dependencies, conversationId)) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, MIRROR_POLL_MS));
  }
  return false;
}
