import type { McpServer } from '@emdash/core/primitives/mcp/api';
import type { Result } from '@emdash/shared';
import { AutoApproveRequests } from '../auto-approve-requests';
import type { McpToolDependencies } from './dependencies';
import { McpHttpServer } from './mcp-http-server';
import { buildEmdashMcpServer } from './register-tools';
import {
  refreshSelfServerRegistration,
  resolveSelfServer,
  type SelfRegistrationDependencies,
} from './self-registration';

export type EmdashMcpServerOptions = Omit<McpToolDependencies, 'confirmAutoApprove'> &
  Readonly<{
    /** Absolute path of the file holding the server's bearer token. */
    tokenFilePath: string;
    /** Brings the app window forward when an MCP client asks the user something. */
    revealApp?: () => void;
  }>;

export type EmdashMcpServerHandle = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Connection details for the managed "emdash" entry in agent configs. */
  resolveSelfServer(providers: string[]): Result<McpServer, string>;
  /** Rewrites an existing self-registration with the current URL and token. */
  refreshRegistration(): Promise<void>;
  /** Auto-approve requests waiting for the user, shown by the renderer. */
  autoApproveRequests: AutoApproveRequests;
}>;

/**
 * Composition root for the local MCP server: assembles the tool dependencies,
 * the HTTP listener, and the agent-config self-registration into one handle the
 * boot phases can start, stop, and hand to the MCP wire controller.
 */
export function createEmdashMcpServer(options: EmdashMcpServerOptions): EmdashMcpServerHandle {
  const autoApproveRequests = new AutoApproveRequests({ reveal: options.revealApp });
  const dependencies: McpToolDependencies = {
    ...options,
    confirmAutoApprove: (request) => autoApproveRequests.request(request),
  };
  const http = new McpHttpServer({
    tokenFilePath: options.tokenFilePath,
    logger: options.logger,
    buildServer: () => buildEmdashMcpServer(dependencies),
  });
  const registration: SelfRegistrationDependencies = {
    runtimes: options.runtimes,
    logger: options.logger,
    getConnectionInfo: () => http.getConnectionInfo(),
  };
  return {
    start: () => http.start(),
    stop: () => {
      autoApproveRequests.denyAll();
      return http.stop();
    },
    resolveSelfServer: (providers) => resolveSelfServer(registration, providers),
    refreshRegistration: () => refreshSelfServerRegistration(registration),
    autoApproveRequests,
  };
}
