/**
 * Bridge protocol types shared between app (client) and host.
 *
 * All communication between the sandboxed iframe and the host happens
 * via window.postMessage using these message shapes.
 */

/** App → Host: invoke a channel method */
export interface BridgeRequest {
  type: 'rool:request';
  id: string;
  method: string;
  args: unknown[];
  /** When present, the host dispatches to channel.conversation(conversationId) */
  conversationId?: string;
}

/** Host → App: result of a channel method call */
export interface BridgeResponse {
  type: 'rool:response';
  id: string;
  result?: unknown;
  error?: string;
}

/** Host → App: channel event pushed in real-time */
export interface BridgeEvent {
  type: 'rool:event';
  name: string;
  data: unknown;
}

/** App → Host: app is loaded and ready for handshake */
export interface BridgeReady {
  type: 'rool:ready';
}

/** Host → App: handshake response with channel metadata */
export interface BridgeInit {
  type: 'rool:init';
  channelId: string;
  spaceId: string;
  spaceName: string;
  role: string;
  linkAccess: string;
  userId: string;
  schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type BridgeMessage =
  | BridgeRequest
  | BridgeResponse
  | BridgeEvent
  | BridgeReady
  | BridgeInit;

/** Type guard for bridge messages */
export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as BridgeMessage).type === 'string' &&
    (data as BridgeMessage).type.startsWith('rool:')
  );
}
