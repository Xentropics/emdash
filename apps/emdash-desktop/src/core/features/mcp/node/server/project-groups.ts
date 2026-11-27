import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import { isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { MementoModelKey } from '@core/primitives/mementos/api';
import { projects } from '@core/services/app-db/node/schema';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { McpToolDependencies } from './dependencies';

/**
 * Sidebar project groups are a fork feature (feat/sidebar-project-groups), kept
 * in the app-wide `workbench.sidebar-groups` memento. The shape is repeated here
 * rather than imported so these tools build without that branch; it must stay in
 * step with `workbenchSidebarGroupsMemento` in workbench/contributions/mementos.ts.
 * The sidebar observes the memento, so changes made here show up at once.
 */
export const PROJECT_GROUPS_MEMENTO_KEY: MementoModelKey = {
  mementoId: 'workbench.sidebar-groups',
  kind: 'app',
  key: '',
};

const groupsStateSchema = z.object({
  version: z.literal('1'),
  groups: z.array(z.object({ id: z.string(), name: z.string(), collapsed: z.boolean() })),
  groupByProjectId: z.record(z.string(), z.string()),
});

export type ProjectGroupsState = z.infer<typeof groupsStateSchema>;

const EMPTY_STATE: ProjectGroupsState = { version: '1', groups: [], groupByProjectId: {} };

/** Reads and writes the groups memento; injected so the tools stay testable. */
export type ProjectGroupsStore = Readonly<{
  read(): Promise<ProjectGroupsState>;
  write(state: ProjectGroupsState): Promise<Result<void, string>>;
}>;

type GroupsDependencies = Pick<McpToolDependencies, 'db' | 'projectGroups'>;

export function parseProjectGroupsRow(
  row: { version: string; data: string } | null
): ProjectGroupsState {
  if (!row || row.version !== '1') return EMPTY_STATE;
  try {
    const parsed = groupsStateSchema.safeParse(JSON.parse(row.data));
    return parsed.success ? parsed.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

async function projectNames(dependencies: GroupsDependencies): Promise<Map<string, string>> {
  const rows = await dependencies.db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(isNull(projects.deletedAt));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export type ProjectGroupListing = {
  groups: {
    id: string;
    name: string;
    collapsed: boolean;
    projects: { id: string; name: string }[];
  }[];
  ungroupedProjects: { id: string; name: string }[];
};

export async function listProjectGroups(
  dependencies: GroupsDependencies
): Promise<ProjectGroupListing> {
  const [state, names] = await Promise.all([
    dependencies.projectGroups.read(),
    projectNames(dependencies),
  ]);
  const groupIds = new Set(state.groups.map((group) => group.id));
  const all = [...names].map(([id, name]) => ({ id, name }));
  const groups = state.groups.map((group) => ({
    ...group,
    projects: all.filter((project) => state.groupByProjectId[project.id] === group.id),
  }));
  // A project whose group no longer exists shows as ungrouped, as in the sidebar.
  const ungroupedProjects = all.filter(
    (project) => !groupIds.has(state.groupByProjectId[project.id] ?? '')
  );
  return { groups, ungroupedProjects };
}

function trimmedName(name: string): Result<string, string> {
  const trimmed = name.trim();
  return trimmed ? ok(trimmed) : err('name must not be empty');
}

async function requireProjects(
  dependencies: GroupsDependencies,
  projectIds: readonly string[]
): Promise<Result<void, string>> {
  if (!projectIds.length) return ok();
  const names = await projectNames(dependencies);
  const unknown = projectIds.filter((id) => !names.has(id));
  return unknown.length ? err(`Unknown project id(s): ${unknown.join(', ')}`) : ok();
}

function findGroup(state: ProjectGroupsState, groupId: string): Result<void, string> {
  return state.groups.some((group) => group.id === groupId)
    ? ok()
    : err(`Project group not found: ${groupId}`);
}

export async function createProjectGroup(
  dependencies: GroupsDependencies,
  input: { name: string; projectIds?: string[] }
): Promise<Result<{ groupId: string; name: string; projectIds: string[] }, string>> {
  const name = trimmedName(input.name);
  if (!name.success) return name;
  const projectIds = [...new Set(input.projectIds ?? [])];
  const known = await requireProjects(dependencies, projectIds);
  if (!known.success) return known;

  const state = await dependencies.projectGroups.read();
  const groupId = `group-${randomUUID()}`;
  const groupByProjectId = { ...state.groupByProjectId };
  for (const projectId of projectIds) groupByProjectId[projectId] = groupId;
  const written = await dependencies.projectGroups.write({
    ...state,
    groups: [...state.groups, { id: groupId, name: name.data, collapsed: false }],
    groupByProjectId,
  });
  if (!written.success) return written;
  return ok({ groupId, name: name.data, projectIds });
}

export async function updateProjectGroup(
  dependencies: GroupsDependencies,
  input: { groupId: string; name?: string; collapsed?: boolean }
): Promise<Result<{ groupId: string; name: string; collapsed: boolean }, string>> {
  if (input.name === undefined && input.collapsed === undefined) {
    return err('Pass name, collapsed or both');
  }
  const name = input.name === undefined ? undefined : trimmedName(input.name);
  if (name && !name.success) return name;

  const state = await dependencies.projectGroups.read();
  const found = findGroup(state, input.groupId);
  if (!found.success) return found;
  const groups = state.groups.map((group) =>
    group.id === input.groupId
      ? {
          ...group,
          ...(name && { name: name.data }),
          ...(input.collapsed !== undefined && { collapsed: input.collapsed }),
        }
      : group
  );
  const written = await dependencies.projectGroups.write({ ...state, groups });
  if (!written.success) return written;
  const updated = groups.find((group) => group.id === input.groupId)!;
  return ok({ groupId: updated.id, name: updated.name, collapsed: updated.collapsed });
}

export async function deleteProjectGroup(
  dependencies: GroupsDependencies,
  input: { groupId: string }
): Promise<Result<{ groupId: string; deleted: true; ungroupedProjectIds: string[] }, string>> {
  const state = await dependencies.projectGroups.read();
  const found = findGroup(state, input.groupId);
  if (!found.success) return found;
  const ungroupedProjectIds = Object.entries(state.groupByProjectId)
    .filter(([, groupId]) => groupId === input.groupId)
    .map(([projectId]) => projectId);
  const written = await dependencies.projectGroups.write({
    ...state,
    groups: state.groups.filter((group) => group.id !== input.groupId),
    groupByProjectId: Object.fromEntries(
      Object.entries(state.groupByProjectId).filter(([, groupId]) => groupId !== input.groupId)
    ),
  });
  if (!written.success) return written;
  return ok({ groupId: input.groupId, deleted: true, ungroupedProjectIds });
}

export async function setProjectGroup(
  dependencies: GroupsDependencies,
  input: { projectId: string; groupId: string | null }
): Promise<Result<{ projectId: string; groupId: string | null }, string>> {
  const known = await requireProjects(dependencies, [input.projectId]);
  if (!known.success) return known;
  const state = await dependencies.projectGroups.read();
  if (input.groupId !== null) {
    const found = findGroup(state, input.groupId);
    if (!found.success) return found;
  }
  const groupByProjectId = { ...state.groupByProjectId };
  if (input.groupId === null) delete groupByProjectId[input.projectId];
  else groupByProjectId[input.projectId] = input.groupId;
  const written = await dependencies.projectGroups.write({ ...state, groupByProjectId });
  if (!written.success) return written;
  return ok({ projectId: input.projectId, groupId: input.groupId });
}

/** The groups store backed by the mementos worker, which the sidebar also observes. */
export function createMementoProjectGroupsStore(
  getClient: () => Promise<Pick<MementosRuntimeClient, 'memento'>>
): ProjectGroupsStore {
  return {
    async read() {
      const client = await getClient();
      const snapshot = await client.memento.state(PROJECT_GROUPS_MEMENTO_KEY, 'value').snapshot();
      return parseProjectGroupsRow(snapshot.data);
    },
    async write(state) {
      const client = await getClient();
      const saved = await client.memento.mutate('save', {
        key: PROJECT_GROUPS_MEMENTO_KEY,
        input: { version: '1', data: JSON.stringify(state), updatedAt: Date.now() },
      });
      return saved.success ? ok() : err(`Could not save project groups: ${saved.error.message}`);
    },
  };
}
