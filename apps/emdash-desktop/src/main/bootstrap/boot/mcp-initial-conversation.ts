import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Logger } from '@emdash/shared/logger';
import { resolveConversationRuntimeTarget } from '@core/features/conversations/node/conversation-runtime-target';
import { hydrateConversation } from '@core/features/conversations/node/hydrateConversation';
import { launchTuiConversation } from '@core/features/conversations/node/launch-tui-conversation';
import type {
  RestartConversation,
  StartInitialConversation,
} from '@core/features/mcp/node/server/dependencies';
import { resolveTask } from '@core/features/projects/api/node/utils';
import type { TaskSessionLaunchContextResolver } from '@core/features/tasks/api/node/task-session-launch-context';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';

export type StartInitialConversationDependencies = Readonly<{
  db: AppDb;
  logger: Logger;
  runtimes: RuntimeBroker;
  taskSessions: Pick<TaskSessionManager, 'getTask'>;
  sessionLaunchContexts: Pick<TaskSessionLaunchContextResolver, 'resolve'>;
  telemetry: Pick<TelemetryService, 'capture'>;
  workspaceIdentity: WorkspaceIdentityService;
  getProviderEnv: (providerId: string) => Promise<Record<string, string> | undefined>;
}>;

/**
 * Starts the agent session for a freshly created task, the same two paths the
 * renderer drives when it opens a task: TUI conversations launch through the
 * host's agent session, ACP conversations start through the host's ACP runtime.
 *
 * The caller must hold the project attachment: both paths reach the task's
 * session, which only exists while the project is attached.
 */
export function createStartInitialConversation(
  dependencies: StartInitialConversationDependencies
): StartInitialConversation {
  return async ({ projectId, taskId, conversationId, type }) => {
    try {
      if (type === 'pty') {
        await hydrateConversation(
          dependencies.db,
          dependencies.taskSessions,
          projectId,
          taskId,
          conversationId,
          dependencies.telemetry
        );
        return { started: true };
      }
      return await startAcpSession(dependencies, conversationId);
    } catch (error) {
      dependencies.logger.warn('McpHttpServer: failed to start the initial conversation', {
        conversationId,
        taskId,
        error: String(error),
      });
      return { started: false, message: String(error) };
    }
  };
}

async function startAcpSession(
  dependencies: StartInitialConversationDependencies,
  conversationId: string
): Promise<{ started: boolean; message?: string }> {
  const target = await resolveConversationRuntimeTarget(
    conversationId,
    dependencies.workspaceIdentity,
    dependencies.db,
    dependencies.getProviderEnv,
    dependencies.sessionLaunchContexts
  );
  if (!target.acpInput) {
    return { started: false, message: 'the conversation has no resolvable ACP session' };
  }
  const runtime = await dependencies.runtimes.client(target.host);
  if (!runtime.success) {
    return { started: false, message: `the task's host is unavailable (${runtime.error.type})` };
  }
  const started = await runtime.data.acp.startSession(
    { ...target.acpInput, mode: 'resume' },
    { timeoutMs: 0 }
  );
  return started.success
    ? { started: true }
    : { started: false, message: started.error.message ?? started.error.type };
}

/**
 * Stops a terminal conversation's agent and launches it again from the stored
 * conversation config, resuming the provider session. This is how a launch-time
 * setting such as auto-approve takes effect on a conversation that is running.
 *
 * The caller must hold the project attachment, as for the initial conversation.
 */
export function createRestartConversation(
  dependencies: Pick<
    StartInitialConversationDependencies,
    'db' | 'logger' | 'taskSessions' | 'telemetry'
  >
): RestartConversation {
  return async ({ projectId, taskId, conversationId }) => {
    try {
      const task = resolveTask(dependencies.taskSessions, projectId, taskId);
      if (!task) return { restarted: false, message: 'the task has no session in Emdash' };
      await task.conversations.stopSession(conversationId);
      await launchTuiConversation({
        projectId,
        taskId,
        conversationId,
        database: dependencies.db,
        telemetry: dependencies.telemetry,
        taskSessions: dependencies.taskSessions,
      });
      return { restarted: true };
    } catch (error) {
      dependencies.logger.warn('McpHttpServer: failed to restart the conversation', {
        conversationId,
        taskId,
        error: String(error),
      });
      return { restarted: false, message: String(error) };
    }
  };
}
