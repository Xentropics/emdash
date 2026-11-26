import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Switch } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const SidebarMetadataSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const busy = isLoading || isSaving;
  const showLineChanges = interfaceSettings?.showLeftSidebarLineChanges ?? true;
  const showPrStatus = interfaceSettings?.showLeftSidebarPrStatus ?? true;
  const showTimestamps = interfaceSettings?.showLeftSidebarTimestamps ?? true;
  const showPinnedPrefix = interfaceSettings?.showPinnedProjectPrefix ?? true;

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <SettingRow
          title="Left sidebar line changes"
          description="Show added and removed line counts for tasks in the left sidebar."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showLeftSidebarLineChanges')}
                defaultLabel="on"
                onReset={() => resetField('showLeftSidebarLineChanges')}
                disabled={busy}
              />
              <Switch
                checked={showLineChanges}
                onCheckedChange={(checked) => update({ showLeftSidebarLineChanges: checked })}
                disabled={busy}
                aria-label="Show left sidebar line changes"
              />
            </>
          }
        />
        <SettingRow
          title="Left sidebar PR status"
          description="Show GitHub PR merge and status icons for tasks in the left sidebar."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showLeftSidebarPrStatus')}
                defaultLabel="on"
                onReset={() => resetField('showLeftSidebarPrStatus')}
                disabled={busy}
              />
              <Switch
                checked={showPrStatus}
                onCheckedChange={(checked) => update({ showLeftSidebarPrStatus: checked })}
                disabled={busy}
                aria-label="Show left sidebar PR status"
              />
            </>
          }
        />
        <SettingRow
          title="Left sidebar timestamps"
          description="Show the relative task timestamp in the left sidebar."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showLeftSidebarTimestamps')}
                defaultLabel="on"
                onReset={() => resetField('showLeftSidebarTimestamps')}
                disabled={busy}
              />
              <Switch
                checked={showTimestamps}
                onCheckedChange={(checked) => update({ showLeftSidebarTimestamps: checked })}
                disabled={busy}
                aria-label="Show left sidebar timestamps"
              />
            </>
          }
        />
        <SettingRow
          title="Project code on pinned tasks"
          description="Show a short code for the task's project before each pinned task."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('showPinnedProjectPrefix')}
                defaultLabel="on"
                onReset={() => resetField('showPinnedProjectPrefix')}
                disabled={busy}
              />
              <Switch
                checked={showPinnedPrefix}
                onCheckedChange={(checked) => update({ showPinnedProjectPrefix: checked })}
                disabled={busy}
                aria-label="Show project code on pinned tasks"
              />
            </>
          }
        />
      </SeparatedList>
    </SettingsCard>
  );
};

export default SidebarMetadataSettingsCard;
