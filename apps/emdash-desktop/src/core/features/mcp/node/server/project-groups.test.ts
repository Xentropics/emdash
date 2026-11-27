import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { McpToolDependencies } from './dependencies';
import {
  createMementoProjectGroupsStore,
  createProjectGroup,
  deleteProjectGroup,
  listProjectGroups,
  parseProjectGroupsRow,
  PROJECT_GROUPS_MEMENTO_KEY,
  setProjectGroup,
  updateProjectGroup,
  type ProjectGroupsState,
} from './project-groups';

const PROJECTS = [
  { id: 'p1', name: 'emdash' },
  { id: 'p2', name: 'omeka-theme' },
  { id: 'p3', name: 'erfgoedzoeker' },
];

function setup(initial?: Partial<ProjectGroupsState>) {
  let state: ProjectGroupsState = { version: '1', groups: [], groupByProjectId: {}, ...initial };
  const write = vi.fn(async (next: ProjectGroupsState) => {
    state = next;
    return ok();
  });
  const chain = { where: async () => PROJECTS };
  const deps = {
    db: { select: () => ({ from: () => chain }) },
    projectGroups: { read: async () => state, write },
  } as unknown as McpToolDependencies;
  return { deps, write, current: () => state };
}

const WORK = { id: 'group-work', name: 'Work', collapsed: false };

describe('project group tools', () => {
  it('lists groups with their projects and the ungrouped rest', async () => {
    const { deps } = setup({
      groups: [WORK],
      groupByProjectId: { p1: 'group-work', p3: 'group-gone' },
    });

    expect(await listProjectGroups(deps)).toEqual({
      groups: [{ ...WORK, projects: [{ id: 'p1', name: 'emdash' }] }],
      ungroupedProjects: [
        { id: 'p2', name: 'omeka-theme' },
        { id: 'p3', name: 'erfgoedzoeker' },
      ],
    });
  });

  it('creates a group at the end and moves projects into it', async () => {
    const { deps, current } = setup({ groups: [WORK], groupByProjectId: { p1: 'group-work' } });

    const result = await createProjectGroup(deps, { name: ' Clients ', projectIds: ['p1', 'p2'] });

    expect(result.success).toBe(true);
    const groupId = result.success ? result.data.groupId : '';
    expect(groupId).toMatch(/^group-/);
    expect(current().groups).toEqual([WORK, { id: groupId, name: 'Clients', collapsed: false }]);
    expect(current().groupByProjectId).toEqual({ p1: groupId, p2: groupId });
  });

  it('refuses unknown projects and empty names without writing', async () => {
    const { deps, write } = setup();

    expect(await createProjectGroup(deps, { name: 'X', projectIds: ['nope'] })).toEqual({
      success: false,
      error: 'Unknown project id(s): nope',
    });
    expect(await createProjectGroup(deps, { name: '  ' })).toMatchObject({ success: false });
    expect(write).not.toHaveBeenCalled();
  });

  it('renames and collapses a group', async () => {
    const { deps, current } = setup({ groups: [WORK] });

    const result = await updateProjectGroup(deps, {
      groupId: 'group-work',
      name: 'Day job',
      collapsed: true,
    });

    expect(result).toEqual(ok({ groupId: 'group-work', name: 'Day job', collapsed: true }));
    expect(current().groups).toEqual([{ id: 'group-work', name: 'Day job', collapsed: true }]);
  });

  it('deletes a group and ungroups its projects', async () => {
    const { deps, current } = setup({
      groups: [WORK],
      groupByProjectId: { p1: 'group-work', p2: 'group-work' },
    });

    const result = await deleteProjectGroup(deps, { groupId: 'group-work' });

    expect(result).toEqual(
      ok({ groupId: 'group-work', deleted: true, ungroupedProjectIds: ['p1', 'p2'] })
    );
    expect(current()).toEqual({ version: '1', groups: [], groupByProjectId: {} });
  });

  it('moves a project between groups and out of them', async () => {
    const other = { id: 'group-other', name: 'Other', collapsed: false };
    const { deps, current } = setup({
      groups: [WORK, other],
      groupByProjectId: { p1: 'group-work' },
    });

    await setProjectGroup(deps, { projectId: 'p1', groupId: 'group-other' });
    expect(current().groupByProjectId).toEqual({ p1: 'group-other' });

    await setProjectGroup(deps, { projectId: 'p1', groupId: null });
    expect(current().groupByProjectId).toEqual({});

    expect(await setProjectGroup(deps, { projectId: 'p1', groupId: 'missing' })).toEqual({
      success: false,
      error: 'Project group not found: missing',
    });
  });
});

describe('memento-backed groups store', () => {
  it('reads an empty state when nothing is saved or the row is unreadable', () => {
    const empty = { version: '1', groups: [], groupByProjectId: {} };
    expect(parseProjectGroupsRow(null)).toEqual(empty);
    expect(parseProjectGroupsRow({ version: '1', data: '{not json' })).toEqual(empty);
    expect(parseProjectGroupsRow({ version: '2', data: '{}' })).toEqual(empty);
  });

  it('saves the state as the sidebar memento row', async () => {
    const mutate = vi.fn(async () => ok(undefined));
    const store = createMementoProjectGroupsStore(async () => ({ memento: { mutate } }) as never);
    const state: ProjectGroupsState = {
      version: '1',
      groups: [WORK],
      groupByProjectId: { p1: 'group-work' },
    };

    await expect(store.write(state)).resolves.toEqual(ok());

    expect(mutate).toHaveBeenCalledWith('save', {
      key: PROJECT_GROUPS_MEMENTO_KEY,
      input: { version: '1', data: JSON.stringify(state), updatedAt: expect.any(Number) },
    });
  });
});
