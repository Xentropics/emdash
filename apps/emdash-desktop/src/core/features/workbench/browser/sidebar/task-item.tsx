import { Tooltip } from '@emdash/ui/react/primitives';
import { Pin, PinOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  getTaskGitCheckoutStore,
  getTaskPrAssociationStore,
} from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import { type TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import {
  getTaskManagerStore,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { TaskContextMenu } from '@core/features/tasks/contributions/browser/task-context-menu';
import { TaskGitDiffStats } from '@core/features/tasks/contributions/browser/task-git-diff-stats';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskWorkspace } from '@core/features/workbench/api/browser/task-composition-selectors';
import { TaskSidebarTrailingSlot } from '@core/features/workbench/browser/sidebar/task-sidebar-agent-status';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import {
  useNavigate,
  useViewParams,
  useWorkspaceSlots,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';
import { selectCurrentPr } from '@root/src/core/services/pull-requests/api';
import { PrBadge } from '@root/src/core/services/pull-requests/browser/components/pr-badge';
import { SidebarItemMiniButton, SidebarMenuAction, SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /** Pinned strip uses tighter padding than tasks nested under a project. */
  rowVariant?: 'underProject' | 'pinned';
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
}: SidebarTaskItemProps) {
  const { navigate } = useNavigate();
  const openRename = useOpenModal('renameTaskModal');
  const openDeleteTask = useOpenModal('deleteTaskModal');

  const { currentView } = useWorkspaceSlots();
  const params = useViewParams(taskViewDef);
  const { value: interfaceSettings } = useAppSettingsKey('interface');
  const isActive =
    currentView === 'task' && params?.taskId === taskId && params.projectId === projectId;

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);

  const taskName = task.data.name;

  const openTask = () => {
    navigate(taskViewDef({ projectId, taskId }));
  };

  const handleArchive = () => {
    if (isActive) navigate(projectViewDef({ projectId }));
    void taskManager?.archiveTask(taskId);
  };

  const handleRename = () => {
    void openRename({ projectId, taskId, currentName: taskName });
  };

  const handleDelete = () => {
    void openDeleteTask({
      projectId,
      tasks: [{ taskId, taskName }],
    }).then((outcome) => {
      if (!outcome.success) return;
      const { deleteWorktree, deleteBranch, deleteConversations } = outcome.data;
      void taskManager?.deleteTasks([taskId], {
        deleteWorktree,
        deleteBranch,
        deleteConversations,
      });
      if (isActive) navigate(projectViewDef({ projectId }));
    });
  };

  const canPin = task.state !== 'unregistered';

  const workspaceStore = getTaskWorkspace(projectId, taskId);
  const git = getTaskGitCheckoutStore(projectId, taskId);
  const showLineChanges = interfaceSettings?.showLeftSidebarLineChanges ?? true;
  const showPrStatus = interfaceSettings?.showLeftSidebarPrStatus ?? true;
  const showTimestamps = interfaceSettings?.showLeftSidebarTimestamps ?? true;
  const projectPrefix =
    rowVariant === 'pinned' && (interfaceSettings?.showPinnedProjectPrefix ?? true)
      ? getSidebarStore().projectPrefixes.get(projectId)
      : undefined;
  const branchName = git?.branchName ?? undefined;
  const handleReconnect =
    workspaceStore?.connectionState != null ? () => workspaceStore.reconnect() : undefined;

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin={canPin}
      isArchived={false}
      branchName={branchName}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onReconnect={handleReconnect}
      onConvertAutomation={undefined}
      onDelete={handleDelete}
    >
      <SidebarMenuRow
        className={cn(
          'group/row flex items-center justify-between px-1 py-1.5 h-8 gap-1',
          rowVariant === 'pinned' ? 'pl-2' : 'pl-8'
        )}
        isActive={isActive}
        onMouseDown={(e) => e.preventDefault()}
        onClick={openTask}
      >
        <SidebarMenuAction
          aria-label={`Open task ${taskName || 'task'}`}
          className="gap-1 overflow-hidden"
        >
          <span
            className={cn(
              'min-w-0 truncate text-left transition-colors',
              task.isBootstrapping && 'text-foreground/40'
            )}
          >
            {projectPrefix && (
              <span className="font-mono text-xs text-foreground-tertiary-passive">
                {projectPrefix}:{' '}
              </span>
            )}
            {taskName}
          </span>
        </SidebarMenuAction>
        <div className="ml-2 flex shrink-0 items-center justify-end gap-1.5">
          {showLineChanges && <TaskGitDiffStats task={task} />}
          {showPrStatus && <RenderPrBadge task={task} />}
          {canPin && (
            <PinToggle
              isPinned={task.data.isPinned}
              inPinnedList={rowVariant === 'pinned'}
              onToggle={() => void task.setPinned(!task.data.isPinned)}
            />
          )}
          <TaskSidebarTrailingSlot task={task} showTimestamp={showTimestamps} />
        </div>
      </SidebarMenuRow>
    </TaskContextMenu>
  );
});

const RenderPrBadge = observer(function RenderPrBadge({ task }: { task: TaskStore }) {
  const pr = selectCurrentPr(getTaskPrAssociationStore(task).pullRequests);
  return pr ? (
    <span onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <PrBadge variant="compact" pr={pr} hoverDelay={100} />
    </span>
  ) : null;
});

/**
 * In the project list: a hover button that pins the task, or for a pinned task a
 * small mark (unpinning happens in the Pinned list). In the Pinned list: a hover
 * button that unpins it.
 */
function PinToggle({
  isPinned,
  inPinnedList,
  onToggle,
}: {
  isPinned: boolean;
  inPinnedList: boolean;
  onToggle: () => void;
}) {
  if (isPinned && !inPinnedList) {
    return (
      <span role="img" aria-label="Pinned" className="flex size-5 items-center justify-center">
        <Pin className="size-3 text-foreground-tertiary-passive" />
      </span>
    );
  }
  const label = isPinned ? 'Unpin' : 'Pin to top';
  const Icon = isPinned ? PinOff : Pin;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <SidebarItemMiniButton
            type="button"
            aria-label={label}
            aria-pressed={isPinned}
            className="hidden size-5 group-focus-within/row:flex group-hover/row:flex"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <Icon className="size-3.5" />
          </SidebarItemMiniButton>
        }
      />
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip.Root>
  );
}
