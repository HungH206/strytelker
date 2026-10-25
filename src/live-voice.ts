import type {
  LiveConnectConfig,
  LiveServerMessage,
  Session,
} from "@google/genai";

export type VoiceCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};
export type LiveCredentials = {
  token: string;
  model: string;
  config: LiveConnectConfig;
  apiVersion: string;
};
export class LiveVoiceConnection {
  private input: AudioContext;
  private output: AudioContext;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private session: Session | null = null;
  private closed = false;
  private ready = false;
  private muted = false;
  private cursor = 0;
  private playback = new Set<AudioBufferSourceNode>();
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  private startup = "";
  constructor(
    private callbacks: {
      onReady: () => void;
      onActivity: (activity: string) => void;
      onTranscript: (
        role: "user" | "agent",
        text: string,
        finished: boolean,
      ) => void;
      onTools: (calls: VoiceCall[]) => void;
      onCancelled: (ids: string[]) => void;
      onError: (message: string) => void;
      onClose: () => void;
    },
  ) {
    // Construct/resume in the click handler so browsers permit audio playback.
    this.input = new AudioContext({ sampleRate: 16000 });
    this.output = new AudioContext();
    void this.input.resume();
    void this.output.resume();
  }
  async prepareAudio() {
    if (this.stream || this.closed) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    await this.input.audioWorklet.addModule("/audio/toyo-input.js");
    if (this.closed) return;
    this.source = this.input.createMediaStreamSource(stream);
    this.processor = new AudioWorkletNode(this.input, "toyo-input");
    this.sink = this.input.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.sink);
    this.sink.connect(this.input.destination);
    this.processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.ready || this.closed || this.muted || !this.session) return;
      const bytes = new Uint8Array(event.data);
      let binary = "";
      for (const value of bytes) binary += String.fromCharCode(value);
      try {
        this.session.sendRealtimeInput({
          audio: { data: btoa(binary), mimeType: "audio/pcm;rate=16000" },
        });
      } catch {
        this.fail(
          "The voice connection was interrupted. Click Voice mode to reconnect.",
        );
      }
    };
  }
  async connect(credentials: LiveCredentials, initialContext: unknown) {
    try {
      await this.prepareAudio();
      if (this.closed) return;
      this.startup = `Begin the TOYO voice conversation at the current stage. Greet briefly and ask the next needed question. Authoritative backend context: ${JSON.stringify(initialContext)}`;
      const { GoogleGenAI } = await import("@google/genai");
      if (this.closed) return;
      const ai = new GoogleGenAI({
        apiKey: credentials.token,
        httpOptions: { apiVersion: credentials.apiVersion },
      });
      this.setupTimer = setTimeout(
        () =>
          this.fail(
            "Gemini Live did not finish connecting. Check model access and try again.",
          ),
        20000,
      );
      const session = await ai.live.connect({
        model: credentials.model,
        config: credentials.config,
        callbacks: {
          onmessage: (message) => this.receive(message),
          onerror: () =>
            this.fail(
              "Gemini Live reported a connection error. Check the model and key access, then reconnect.",
            ),
          onclose: () => {
            if (!this.closed) {
              this.stop();
              this.callbacks.onClose();
            }
          },
        },
      });
      if (this.closed) {
        session.close();
        return;
      }
      this.session = session;
      if (this.ready) this.begin();
    } catch (error) {
      if (this.closed) return;
      const denied =
        error instanceof DOMException && error.name === "NotAllowedError";
      this.fail(
        denied
          ? "Microphone access was denied. Allow microphone access for this site, then retry."
          : "Could not start live voice. Check your microphone, network and Gemini Live configuration.",
      );
    }
  }
  private begin() {
    if (!this.startup || !this.session) return;
    const text = this.startup;
    this.startup = "";
    this.sendContext(text);
  }
  private receive(message: LiveServerMessage) {
    if (this.closed) return;
    if (message.setupComplete) {
      this.ready = true;
      if (this.setupTimer) clearTimeout(this.setupTimer);
      this.callbacks.onReady();
      this.begin();
    }
    const content = message.serverContent;
    if (content?.interrupted) {
      this.stopPlayback();
      this.callbacks.onActivity("Listening");
    }
    if (content?.inputTranscription?.text)
      this.callbacks.onTranscript(
        "user",
        content.inputTranscription.text,
        !!content.inputTranscription.finished,
      );
    if (content?.outputTranscription?.text)
      this.callbacks.onTranscript(
        "agent",
        content.outputTranscription.text,
        !!content.outputTranscription.finished,
      );
    for (const part of content?.modelTurn?.parts || []) {
      const audio = part.inlineData;
      if (audio?.data && audio.mimeType?.startsWith("audio/pcm"))
        this.play(
          audio.data,
          Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] || 24000),
        );
    }
    if (content?.turnComplete && !this.playback.size)
      this.callbacks.onActivity("Listening");
    if (message.toolCall?.functionCalls)
      this.callbacks.onTools(message.toolCall.functionCalls);
    if (message.toolCallCancellation?.ids)
      this.callbacks.onCancelled(message.toolCallCancellation.ids);
    if (message.goAway)
      this.fail(
        "This Gemini voice session is ending. Reconnect Voice mode to continue your current shopping step.",
      );
  }
  private play(base64: string, rate: number) {
    if (rate < 8000 || rate > 96000) return;
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const length = Math.floor(bytes.length / 2);
    if (!length) return;
    const view = new DataView(bytes.buffer);
    const buffer = this.output.createBuffer(1, length, rate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;
    const node = this.output.createBufferSource();
    node.buffer = buffer;
    node.connect(this.output.destination);
    this.cursor = Math.max(this.cursor, this.output.currentTime);
    if (this.cursor - this.output.currentTime > 20) this.stopPlayback();
    this.playback.add(node);
    node.onended = () => {
      this.playback.delete(node);
      node.disconnect();
      if (!this.closed && !this.playback.size)
        this.callbacks.onActivity("Listening");
    };
    node.start(this.cursor);
    this.cursor += buffer.duration;
    this.callbacks.onActivity("Speaking");
  }
  private stopPlayback() {
    for (const node of this.playback) {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
      node.disconnect();
    }
    this.playback.clear();
    this.cursor = this.output.currentTime;
  }
  sendContext(text: string) {
    if (!this.ready || this.closed || !this.session) return;
    this.stopPlayback();
    this.session.sendClientContent({
      turns: [{ role: "user", parts: [{ text }] }],
      turnComplete: true,
    });
  }
  respond(
    responses: Array<{
      id?: string;
      name: string;
      response: Record<string, unknown>;
    }>,
  ) {
    if (!this.closed)
      this.session?.sendToolResponse({ functionResponses: responses });
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !value;
    });
    if (value && this.ready)
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }
  private fail(message: string) {
    if (!this.closed) {
      this.stop();
      this.callbacks.onError(message);
    }
  }
  stop() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    if (this.setupTimer) clearTimeout(this.setupTimer);
    this.session?.close();
    this.session = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.processor?.disconnect();
    this.sink?.disconnect();
    this.stopPlayback();
    void this.input.close().catch(() => {});
    void this.output.close().catch(() => {});
  }
}
