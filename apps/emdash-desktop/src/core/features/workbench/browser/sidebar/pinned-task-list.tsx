import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MicroLabel } from '@emdash/ui/react/primitives';
import { ChevronRight, PinOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import {
  clampPinnedListRatio,
  MAX_PINNED_LIST_RATIO,
  MIN_PINNED_LIST_RATIO,
  pinKey,
} from '@core/features/workbench/browser/sidebar/sidebar-store';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { cn } from '@core/primitives/styling/browser/cn';
import { SidebarScrollFade } from './scroll-fade';
import { SidebarGroup, SidebarMenu } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const sidebar = getSidebarStore();
  const entries = sidebar.pinnedSidebarEntries;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const groupRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Height while the divider is being dragged; saved to the memento on release.
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  if (entries.length === 0) return null;

  const ids = entries.map(({ projectId, taskId }) => pinKey(projectId, taskId));

  // Pinned tasks reorder only among each other; the project list is a separate list.
  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    if (over.id === UNPIN_TARGET_ID) {
      const entry = entries.find((e) => pinKey(e.projectId, e.taskId) === active.id);
      if (entry) void getTaskStore(entry.projectId, entry.taskId)?.setPinned(false);
      return;
    }
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    sidebar.setPinnedOrder(arrayMove(entries, from, to));
  }

  const isCollapsed = sidebar.isPinnedListCollapsed;
  const ratio = dragRatio ?? sidebar.pinnedListMaxHeightRatio;
  const activeEntry = activeDragId
    ? entries.find((e) => pinKey(e.projectId, e.taskId) === activeDragId)
    : undefined;

  // Capped (by dragging the divider below it) so a long Pinned list scrolls on its own
  // instead of pushing the projects down. With few pins it stays as short as its rows.
  return (
    <>
      <SidebarGroup
        ref={groupRef}
        className="relative mb-0 flex min-h-0 shrink-0 flex-col"
        style={{ maxHeight: `${ratio * 100}%` }}
      >
        <button
          type="button"
          aria-expanded={!isCollapsed}
          className="group/pinned flex h-[40px] shrink-0 items-center gap-1 pr-2.5 pl-5 text-left"
          onClick={() => sidebar.toggleCollapsedPinnedList()}
        >
          <MicroLabel className="font-medium text-foreground-tertiary-passive">Pinned</MicroLabel>
          <ChevronRight
            className={cn(
              'size-3 text-foreground-tertiary-passive transition-all duration-150',
              isCollapsed ? 'opacity-100' : 'rotate-90 opacity-0 group-hover/pinned:opacity-100'
            )}
          />
          {isCollapsed && (
            <MicroLabel className="ml-auto text-foreground-tertiary-passive tabular-nums">
              {entries.length}
            </MicroLabel>
          )}
        </button>
        {!isCollapsed && (
          <div className="relative flex min-h-0 flex-col">
            <div ref={scrollRef} className="min-h-0 overflow-y-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={pinnedCollision}
                onDragStart={({ active }) => setActiveDragId(String(active.id))}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveDragId(null)}
              >
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  <SidebarMenu className="px-3 pb-2">
                    {entries.map(({ projectId, taskId }) => (
                      <SortablePinnedRow
                        key={pinKey(projectId, taskId)}
                        id={pinKey(projectId, taskId)}
                      >
                        <SidebarTaskItem
                          projectId={projectId}
                          taskId={taskId}
                          rowVariant="pinned"
                        />
                      </SortablePinnedRow>
                    ))}
                  </SidebarMenu>
                </SortableContext>
                {activeDragId && <UnpinTarget />}
                <DragOverlay dropAnimation={null}>
                  {activeEntry ? (
                    <div className="px-3">
                      <div className="rounded-lg bg-background-tertiary-2 shadow-md">
                        <SidebarTaskItem
                          projectId={activeEntry.projectId}
                          taskId={activeEntry.taskId}
                          rowVariant="pinned"
                        />
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
            <SidebarScrollFade scrollRef={scrollRef} />
          </div>
        )}
      </SidebarGroup>
      <PinnedListResizeHandle
        groupRef={groupRef}
        ratio={ratio}
        disabled={isCollapsed}
        onDrag={setDragRatio}
        onCommit={(next) => {
          sidebar.setPinnedListMaxHeightRatio(next);
          setDragRatio(null);
        }}
      />
    </>
  );
});

const UNPIN_TARGET_ID = 'unpin-target';

/** Rows reorder by plain closest-center; below the Pinned list is the unpin target. */
const pinnedCollision: CollisionDetection = (args) => {
  const unpinRect = args.droppableRects.get(UNPIN_TARGET_ID);
  if (unpinRect && args.pointerCoordinates && args.pointerCoordinates.y >= unpinRect.top) {
    return [{ id: UNPIN_TARGET_ID }];
  }
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => c.id !== UNPIN_TARGET_ID),
  });
};

/**
 * While a pinned task is dragged, covers the "Projects" header just below the
 * list as the drop target for unpinning it. Dropping anywhere lower counts too.
 */
function UnpinTarget() {
  const { setNodeRef, isOver } = useDroppable({ id: UNPIN_TARGET_ID });
  return (
    <div
      ref={setNodeRef}
      className="absolute inset-x-0 top-full z-20 flex h-[41px] items-center bg-(--em-surface) pr-2.5 pl-3"
    >
      <div
        className={cn(
          'flex h-8 flex-1 items-center gap-2 rounded-lg border border-dashed border-border px-2 text-sm text-foreground-tertiary-passive',
          isOver &&
            'border-foreground-tertiary-passive bg-background-tertiary-2 text-foreground-tertiary'
        )}
      >
        <PinOff className="size-3.5" />
        Unpin
      </div>
    </div>
  );
}

const KEYBOARD_STEP = 0.05;

/**
 * The divider under the Pinned list. Dragging it sets the list's largest height as a
 * share of the sidebar; it looks like the UI kit's resize handle (a 1px line with a
 * wider hit area).
 */
function PinnedListResizeHandle({
  groupRef,
  ratio,
  disabled,
  onDrag,
  onCommit,
}: {
  groupRef: RefObject<HTMLDivElement | null>;
  ratio: number;
  disabled: boolean;
  onDrag: (ratio: number) => void;
  onCommit: (ratio: number) => void;
}) {
  if (disabled) return <div className="h-px shrink-0 bg-border" />;

  function ratioAt(clientY: number): number | undefined {
    const container = groupRef.current?.parentElement;
    if (!container) return undefined;
    const rect = container.getBoundingClientRect();
    if (rect.height <= 0) return undefined;
    return clampPinnedListRatio((clientY - rect.top) / rect.height);
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let latest = ratio;
    const move = (ev: globalThis.PointerEvent) => {
      const next = ratioAt(ev.clientY);
      if (next === undefined) return;
      latest = next;
      onDrag(next);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      onCommit(latest);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onCommit(ratio + (e.key === 'ArrowDown' ? KEYBOARD_STEP : -KEYBOARD_STEP));
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize Pinned list"
      aria-valuemin={Math.round(MIN_PINNED_LIST_RATIO * 100)}
      aria-valuemax={Math.round(MAX_PINNED_LIST_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      className="relative z-10 h-px shrink-0 cursor-row-resize bg-border outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 hover:bg-foreground-tertiary-passive focus-visible:bg-foreground-tertiary-passive"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}

function SortablePinnedRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        // Vertical only: the row follows the pointer up and down within the list.
        transform: CSS.Transform.toString(transform && { ...transform, x: 0 }),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
      }}
      data-pin-key={id}
      {...listeners}
    >
      {children}
    </div>
  );
}

/**
 * Pins a task dropped on the Pinned list at the row under the pointer (`clientY`);
 * below the rows, or when the list is folded or empty, it goes last.
 */
export function pinTaskAt(projectId: string, taskId: string, clientY: number): void {
  const rows = document.querySelectorAll<HTMLElement>('[data-pin-key]');
  let index = 0;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.top + rect.height / 2 < clientY) index++;
  }
  getSidebarStore().placePinnedEntry({ projectId, taskId }, index);
  void getTaskStore(projectId, taskId)?.setPinned(true);
}
