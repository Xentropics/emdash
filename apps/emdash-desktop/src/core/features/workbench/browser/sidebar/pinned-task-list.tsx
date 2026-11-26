import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
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
import { ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { pinKey } from '@core/features/workbench/browser/sidebar/sidebar-store';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { cn } from '@core/primitives/styling/browser/cn';
import { SidebarGroup, SidebarMenu } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const sidebar = getSidebarStore();
  const entries = sidebar.pinnedSidebarEntries;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  if (entries.length === 0) return null;

  const ids = entries.map(({ projectId, taskId }) => pinKey(projectId, taskId));

  // Pinned tasks reorder only among each other; the project list is a separate list.
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    sidebar.setPinnedOrder(arrayMove(entries, from, to));
  }

  const isCollapsed = sidebar.isPinnedListCollapsed;

  // Capped so a long Pinned list scrolls on its own instead of pushing the projects down.
  return (
    <SidebarGroup className="mb-0 flex max-h-[40%] min-h-0 shrink-0 flex-col border-b">
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
        <div className="min-h-0 overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <SidebarMenu className="px-3 pb-2">
                {entries.map(({ projectId, taskId }) => (
                  <SortablePinnedRow key={pinKey(projectId, taskId)} id={pinKey(projectId, taskId)}>
                    <SidebarTaskItem projectId={projectId} taskId={taskId} rowVariant="pinned" />
                  </SortablePinnedRow>
                ))}
              </SidebarMenu>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </SidebarGroup>
  );
});

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
      {...listeners}
    >
      {children}
    </div>
  );
}
