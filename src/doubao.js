/**
 * Doubao Voice Bridge TCP Client: connects to /Users/ldd/proj/doubao-voice-bridge
 * listening on TCP port 4387 (control) and port 5004 (raw audio streaming).
 *
 * Streams real-time partial/text/final events from Doubao IME into controller.js,
 * and streams raw 48kHz s16le PCM audio from the browser to Doubao's audio receiver.
 */
import { EventEmitter } from "node:events";
import net from "node:net";

export class DoubaoBridgeClient extends EventEmitter {
  constructor({ host = "127.0.0.1", port = 4387, audioPort = 5004, reconnectInterval = 3000 } = {}) {
    super();
    this.host = host;
    this.port = Number(port);
    this.audioPort = Number(audioPort);
    this.reconnectInterval = reconnectInterval;
    this.socket = null;
    this.connected = false;
    this.buffer = "";
    this.reconnectTimer = null;
    this._closed = false;
    this.activeSessionId = null;

    // Audio stream socket
    this.audioSocket = null;
    this.audioConnected = false;
    this.audioQueue = [];
  }

  connect() {
    if (this._closed) return;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
      this.connected = true;
      this.emit("connected", { host: this.host, port: this.port });
    });

    this.socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf-8");
      while (this.buffer.includes("\n")) {
        const idx = this.buffer.indexOf("\n");
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          this._handleMessage(msg);
        } catch (e) {
          // ignore invalid JSON lines
        }
      }
    });

    this.socket.on("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      if (wasConnected) {
        this.emit("disconnected");
      }
      this._scheduleReconnect();
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  _scheduleReconnect() {
    if (this._closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  // ------------------------------------------------------------ Audio Stream (Port 5004)
  connectAudio() {
    if (this._closed) return;
    if (this.audioSocket && this.audioConnected) return;
    if (this.audioSocket) {
      this.audioSocket.destroy();
      this.audioSocket = null;
    }

    this.audioSocket = net.createConnection({ host: this.host, port: this.audioPort }, () => {
      this.audioConnected = true;
      this.emit("audio_connected", { host: this.host, port: this.audioPort });
      // Flush any queued audio
      while (this.audioQueue.length > 0) {
        const chunk = this.audioQueue.shift();
        this.audioSocket.write(chunk);
      }
    });

    this.audioSocket.on("close", () => {
      this.audioConnected = false;
      this.audioSocket = null;
    });

    this.audioSocket.on("error", (err) => {
      this.audioConnected = false;
      this.emit("audio_error", err);
    });
  }

  /**
   * Write raw 48kHz s16le PCM audio chunk to Doubao's audio port (5004).
   * @param {Buffer|Uint8Array} chunk
   */
  writeAudio(chunk) {
    if (this._closed || !chunk || chunk.length === 0) return;
    if (!this.audioSocket || !this.audioConnected) {
      this.audioQueue.push(chunk);
      if (this.audioQueue.length > 50) this.audioQueue.shift(); // keep queue bounded
      this.connectAudio();
      return;
    }
    try {
      this.audioSocket.write(chunk);
    } catch {
      // transient socket write error
    }
  }

  closeAudio() {
    this.audioQueue = [];
    if (this.audioSocket) {
      try {
        this.audioSocket.destroy();
      } catch {}
      this.audioSocket = null;
    }
    this.audioConnected = false;
  }

  // ------------------------------------------------------------ Control Messages (Port 4387)
  _handleMessage(msg) {
    this.emit("message", msg);
    const type = msg.type;

    if (type === "hello") {
      this.emit("ready", msg);
      return;
    }

    if (type === "status") {
      this.emit("phase", msg.phase);
      return;
    }

    if (msg.session_id != null) {
      this.activeSessionId = msg.session_id;
    }

    const utteranceId = this.activeSessionId ? `doubao-s${this.activeSessionId}` : `doubao-live`;

    if (type === "partial" || type === "text") {
      if (msg.text != null) {
        this.emit("transcript", {
          text: msg.text,
          final: false,
          utteranceId,
          delta: msg.delta || null,
        });
      }
    } else if (type === "final") {
      this.emit("transcript", {
        text: msg.text || "",
        final: true,
        utteranceId,
      });
      this.activeSessionId = null;
    }
  }

  send(command) {
    if (!this.socket || !this.connected) return false;
    try {
      this.socket.write(command.trim() + "\n");
      return true;
    } catch {
      return false;
    }
  }

  startSession() {
    this.connectAudio();
    return this.send("start");
  }

  stopSession() {
    return this.send("stop");
  }

  clear() {
    return this.send("clear");
  }

  close() {
    this._closed = true;
    clearTimeout(this.reconnectTimer);
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
      this.socket = null;
    }
    this.closeAudio();
    this.connected = false;
  }
}
