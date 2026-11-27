import { hostRefSchema } from '@emdash/core/primitives/host/api';
import {
  agentConfigContract,
  agentConfigMcpErrorSchema,
  mcpServerListSchema,
} from '@emdash/core/runtimes/agent-config/api';
import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import { defineContract, fallible, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

const hostInputSchema = z.object({ host: hostRefSchema });
const providerInputSchema = hostInputSchema.extend({ providerId: z.string() });
const mcpErrorSchema = z.union([agentConfigMcpErrorSchema, runtimeResolveErrorSchema]);

export const mcpDomain = 'mcp' as const;

/**
 * An MCP client asking to run an agent with permission prompts skipped (or to turn
 * that off again). Emdash shows it to the user, who allows or denies it in the app.
 */
export const autoApproveRequestSchema = z.object({
  id: z.string(),
  /** `create`: a new task's agent; `change`: an existing conversation's agent. */
  kind: z.enum(['create', 'change']),
  enable: z.boolean(),
  taskName: z.string(),
  projectName: z.string().nullable(),
  providerName: z.string().nullable(),
  /** Whether the agent restarts (resuming its session) once the change is allowed. */
  restartsAgent: z.boolean(),
});
export type AutoApproveRequest = z.infer<typeof autoApproveRequestSchema>;

export const mcpContract = defineContract({
  servers: liveModel({
    key: hostInputSchema,
    states: {
      list: liveState({ data: mcpServerListSchema }),
    },
  }),
  saveServer: fallible({
    input: agentConfigContract.saveMcpServer.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: mcpErrorSchema,
  }),
  removeServer: fallible({
    input: agentConfigContract.removeMcpServer.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: mcpErrorSchema,
  }),
  removeForAgent: fallible({
    input: agentConfigContract.removeMcpForAgent.input.extend(hostInputSchema.shape),
    data: z.void(),
    error: mcpErrorSchema,
  }),
  autoApproveRequests: liveModel({
    key: z.void(),
    states: {
      pending: liveState({ data: z.array(autoApproveRequestSchema) }),
    },
  }),
  resolveAutoApproveRequest: procedure({
    input: z.object({ id: z.string(), allow: z.boolean() }),
    output: z.void(),
  }),
  listForAgent: fallible({
    input: providerInputSchema,
    data: z.object({ servers: mcpServerListSchema }),
    error: mcpErrorSchema,
  }),
});

export type McpContract = typeof mcpContract;
