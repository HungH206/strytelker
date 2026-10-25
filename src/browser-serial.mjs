// Web Serial transports button events; it cannot attest that a press is physical.
export class BrowserArduino {
  constructor({ serial, onConnectionChange = () => {}, onError = () => {} }) {
    this.serial = serial;
    this.onConnectionChange = onConnectionChange;
    this.onError = onError;
    this.connected = false;
    this.pending = null;
    this.writes = Promise.resolve();
  }

  async connect() {
    if (this.connected) return;
    // Keep the picker directly inside the click-triggered call chain.
    const port = await this.serial.requestPort();
    await port.open({ baudRate: 9600 });
    try {
      this.port = port;
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();
      this.connected = true;
      this.onConnectionChange(true);
      this.readTask = this.readLines();
    } catch (error) {
      this.writer?.releaseLock();
      await port.close().catch(() => {});
      throw error;
    }
  }

  write(command) {
    const operation = this.writes.then(async () => {
      if (!this.connected || !this.writer)
        throw new Error("Arduino is disconnected.");
      await this.writer.write(new TextEncoder().encode(command));
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  async arm(nonce, gestures, onPress) {
    if (!/^[a-f0-9]{24}$/.test(nonce))
      throw new Error("Invalid Arduino arm token.");
    const pending = { nonce, onPress, expires: Date.now() + 30000 };
    this.pending = pending;
    try {
      await this.write(`ARM ${nonce}${gestures ? " NAV" : ""}\n`);
    } catch (error) {
      if (this.pending === pending) this.pending = null;
      throw error;
    }
  }

  disarm() {
    this.pending = null;
    if (!this.connected) return Promise.resolve();
    return this.write("DISARM\n");
  }

  acceptLine(line) {
    const press = /^PRESS ([a-f0-9]{24})(?: ([12]))?$/.exec(line.trim());
    const pending = this.pending;
    if (!press || !pending || press[1] !== pending.nonce) return;
    this.pending = null; // Consume before invoking asynchronous API work.
    if (Date.now() >= pending.expires) return;
    Promise.resolve()
      .then(() =>
        pending.onPress({ nonce: pending.nonce, count: Number(press[2] || 1) }),
      )
      .catch(this.onError);
  }

  async readLines() {
    const decoder = new TextDecoder();
    let line = "";
    let dropping = false;
    try {
      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        for (const character of decoder.decode(value, { stream: true })) {
          if (character === "\n") {
            if (!dropping && this.connected) this.acceptLine(line);
            line = "";
            dropping = false;
          } else if (!dropping) {
            line += character;
            if (line.length > 256) {
              line = "";
              dropping = true;
            }
          }
        }
      }
    } catch (error) {
      if (this.connected) this.onError(error);
    } finally {
      const unexpected = this.connected;
      this.connected = false;
      this.pending = null;
      this.reader.releaseLock();
      if (unexpected) {
        await this.writes;
        this.writer?.releaseLock();
        this.writer = null;
        await this.port?.close().catch(() => {});
        this.onConnectionChange(false);
      }
    }
  }

  async disconnect() {
    await this.disarm().catch(() => {});
    this.connected = false;
    this.pending = null;
    await this.reader?.cancel().catch(() => {});
    await this.readTask;
    await this.writes;
    this.writer?.releaseLock();
    this.writer = null;
    await this.port?.close().catch(() => {});
    this.port = null;
    this.onConnectionChange(false);
  }
}
