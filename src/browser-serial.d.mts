export type SerialDevice = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};
export type SerialAccess = { requestPort(): Promise<SerialDevice> };
export class BrowserArduino {
  constructor(options: {
    serial: SerialAccess;
    onConnectionChange?: (connected: boolean) => void;
    onError?: (error: unknown) => void;
  });
  connected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  arm(
    nonce: string,
    gestures: boolean,
    onPress: (event: { nonce: string; count: number }) => void | Promise<void>,
  ): Promise<void>;
  disarm(): Promise<void>;
}
