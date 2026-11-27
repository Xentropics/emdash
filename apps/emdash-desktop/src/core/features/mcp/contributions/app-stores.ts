import { McpAutoApprovePrompts } from '@core/features/mcp/browser/auto-approve-prompts';
import {
  contributeScopedStore,
  scopedStoreToken,
  type AppScopedStoreContribution,
} from '@core/primitives/scoped-stores/browser';

const autoApprovePromptsToken = scopedStoreToken<McpAutoApprovePrompts>('mcp.auto-approve-prompts');

export const mcpAppStoreContributions: readonly AppScopedStoreContribution[] = [
  contributeScopedStore({
    token: autoApprovePromptsToken,
    create: () => new McpAutoApprovePrompts(),
    activate: (store) => void store.start(),
    dispose: (store) => store.dispose(),
  }),
];
