import { V2_LOG_NAMESPACE } from './namespaces';

export function logV2Route(requestId: string, conversationId: string | undefined): void {
  console.info(`[${V2_LOG_NAMESPACE}] route verification`, { requestId, conversationId });
}
