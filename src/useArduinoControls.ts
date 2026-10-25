import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { BrowserArduino, type SerialAccess } from "./browser-serial.mjs";

type InputState = {
  revision: number;
  stage: string;
  vehicleId: string | null;
  reviewed: boolean;
};
type Transport = "local" | "browser";
type Api = (path: string, body?: unknown) => Promise<any>;
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Arduino connection failed.";

export function useArduinoControls<S extends InputState>({
  state,
  busy,
  lock,
  api,
  setState,
}: {
  state: S | null;
  busy: boolean;
  lock: MutableRefObject<boolean>;
  api: Api;
  setState: Dispatch<SetStateAction<S | null>>;
}) {
  const [transport, setTransport] = useState<Transport>(() =>
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
      ? "local"
      : "browser",
  );
  const [enabled, setEnabled] = useState(false);
  const [localConnected, setLocalConnected] = useState(false);
  const [browserConnected, setBrowserConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState("D2 navigation is off");
  const browser = useRef<BrowserArduino | null>(null);
  const alive = useRef(true);
  const connectionAttempt = useRef(0);
  const live = useRef({ api, state, enabled, transport });
  live.current = { api, state, enabled, transport };
  const serial = (navigator as Navigator & { serial?: SerialAccess }).serial;
  const browserSupported = window.isSecureContext && !!serial;
  const connected = transport === "browser" ? browserConnected : localConnected;
  const canUse =
    !!state &&
    (state.stage === "hq" ||
      (state.stage === "dealer" && !!state.vehicleId) ||
      (state.stage === "checkout" && state.reviewed));

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    async function poll() {
      try {
        const hardware = await live.current.api("hardware");
        if (!cancelled) setLocalConnected(hardware.connected);
      } catch {
        if (!cancelled) setLocalConnected(false);
      }
    }
    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      alive.current = false;
      connectionAttempt.current++;
      window.clearInterval(timer);
      void browser.current?.disconnect();
    };
  }, []);

  async function connect() {
    if (
      !browserSupported ||
      !serial ||
      connecting ||
      browser.current?.connected
    )
      return;
    const attempt = ++connectionAttempt.current;
    setConnecting(true);
    const controller = new BrowserArduino({
      serial,
      onConnectionChange(value) {
        if (!alive.current || attempt !== connectionAttempt.current) return;
        setBrowserConnected(value);
        if (!value) {
          setEnabled(false);
          setStatus("Arduino disconnected. Reconnect to continue.");
        }
      },
      onError(error) {
        if (alive.current && attempt === connectionAttempt.current)
          setStatus(message(error));
      },
    });
    browser.current = controller;
    try {
      await controller.connect();
      if (!alive.current || attempt !== connectionAttempt.current) {
        await controller.disconnect();
        return;
      }
      setEnabled(true);
    } catch (error) {
      if (alive.current && attempt === connectionAttempt.current)
        setStatus(
          error instanceof DOMException && error.name === "NotFoundError"
            ? "No Arduino selected. Click Connect Arduino to try again."
            : `${message(error)} Close Serial Monitor and any local server using ARDUINO_PORT, then retry.`,
        );
    } finally {
      if (alive.current && attempt === connectionAttempt.current)
        setConnecting(false);
    }
  }
  async function disconnect() {
    setEnabled(false);
    await browser.current?.disconnect();
    setBrowserConnected(false);
    setStatus("Arduino disconnected.");
  }
  async function changeTransport(value: Transport) {
    const attempt = ++connectionAttempt.current;
    const previous = browser.current;
    setConnecting(false);
    setEnabled(false);
    setTransport(value);
    await previous?.disconnect();
    if (alive.current && attempt === connectionAttempt.current) {
      setBrowserConnected(false);
      setStatus("D2 navigation is off");
    }
  }

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    let challenge: string | null = null;
    const revision = state.revision;
    const controller = browser.current;
    async function arm() {
      try {
        if (transport === "local") {
          const result = await live.current.api("hardware/arm", { revision });
          challenge = result.nonce;
          if (cancelled) {
            void live.current
              .api("hardware/disarm", { revision, nonce: result.nonce })
              .catch(() => {});
            return;
          }
        } else {
          const result = await live.current.api("browser-serial/arm", {
            revision,
          });
          if (cancelled || !controller?.connected) {
            void live.current
              .api("browser-serial/disarm", { revision, nonce: result.nonce })
              .catch(() => {});
            return;
          }
          challenge = result.nonce;
          await controller.arm(result.nonce, result.gestures, async (press) => {
            if (
              cancelled ||
              !live.current.enabled ||
              live.current.transport !== "browser"
            )
              return;
            if (lock.current) {
              setStatus("TOYO is updating. Wait a moment and retry.");
              return;
            }
            lock.current = true;
            setStatus("Processing D2 press…");
            try {
              const latest = await live.current.api("browser-serial/press", {
                revision,
                ...press,
              });
              if (alive.current)
                setState((current) =>
                  current?.revision === revision ? latest : current,
                );
            } catch (error) {
              if (alive.current) {
                setStatus(message(error));
                // A concurrent update can invalidate the challenge; fetch the authoritative state.
                const latest = await live.current
                  .api("session")
                  .catch(() => null);
                if (latest)
                  setState((current) =>
                    current && latest.revision > current.revision
                      ? latest
                      : current,
                  );
              }
            } finally {
              lock.current = false;
            }
          });
        }
        if (!cancelled) setStatus("D2 ready · waiting for your press");
      } catch (error) {
        if (!cancelled) setStatus(message(error));
      }
    }
    if (
      !enabled ||
      !canUse ||
      busy ||
      (transport === "browser" && !browserConnected)
    ) {
      void controller?.disarm().catch(() => {});

      setStatus(
        enabled
          ? "D2 paused while you enter or review values"
          : "D2 navigation is off",
      );
      return;
    }
    setStatus("Preparing D2…");
    void arm();
    const timer = window.setInterval(arm, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (transport === "browser") void controller?.disarm().catch(() => {});
      if (challenge) {
        const path =
          transport === "browser" ? "browser-serial/disarm" : "hardware/disarm";
        void live.current
          .api(path, { revision, nonce: challenge })
          .catch(() => {});
      }
    };
  }, [
    enabled,
    canUse,
    state?.revision,
    busy,
    transport,
    browserConnected,
    lock,
    setState,
  ]);

  return {
    transport,
    changeTransport,
    enabled,
    setEnabled,
    connected,
    browserConnected,
    browserSupported,
    connecting,
    connect,
    disconnect,
    status,
  };
}
