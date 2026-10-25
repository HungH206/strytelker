import { randomBytes } from "node:crypto";
import { SerialPort } from "serialport";

// Only this server-owned serial connection can produce hardware confirmations.
export function createArduinoBridge(
  path = process.env.ARDUINO_PORT,
  Port = SerialPort,
) {
  let port;
  let pending;
  let buffer = "";
  let error = "";
  let sound = null;
  const cancel = () => {
    pending = undefined;
  };
  if (path) {
    port = new Port({ path, baudRate: 9600 });
    port.on("error", (cause) => {
      error = cause.message;
      cancel();
    });
    port.on("close", cancel);
    port.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 512) {
        buffer = "";
        return;
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (/^SOUND \d{1,5}$/.test(line)) {
          sound = { raw: Number(line.slice(6)), sampledAt: Date.now() };
          continue;
        }
        const press = /^PRESS ([a-f0-9]{24})(?: ([12]))?$/.exec(line);
        if (!pending || !press || press[1] !== pending.nonce) continue;
        const count = Number(press[2] || 1);
        const request = pending;
        cancel();
        if (Date.now() < request.expires) request.confirm(count);
      }
    });
  }
  return {
    status: () => ({ connected: !!port?.isOpen && !error, error, sound }),
    disarm(owner, nonce) {
      if (
        pending &&
        pending.owner === owner &&
        (!nonce || pending.nonce === nonce)
      ) {
        cancel();
        if (port?.isOpen) port.write("DISARM\n", () => {});
      }
    },
    arm(confirm, { owner, gestures = false } = {}) {
      if (!port?.isOpen || error)
        throw new Error(
          error || "Arduino is not connected. Set ARDUINO_PORT and restart.",
        );
      if (
        pending &&
        Date.now() < pending.expires &&
        (!owner || pending.owner !== owner)
      )
        throw new Error("The Arduino is already armed. Wait up to 30 seconds.");
      const nonce = randomBytes(12).toString("hex");
      pending = { nonce, confirm, owner, expires: Date.now() + 30000 };
      port.write(`ARM ${nonce}${gestures ? " NAV" : ""}\n`, (cause) => {
        if (cause) {
          error = cause.message;
          cancel();
        }
      });
      return nonce;
    },
  };
}
