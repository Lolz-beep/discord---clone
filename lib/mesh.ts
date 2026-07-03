/**
 * WebRTC mesh manager (browser-only — instantiated exclusively from Client
 * Components; never runs server-side).
 *
 * TOPOLOGY / SIGNALING FLOW
 * =========================
 * Small rooms (2–6 people), full mesh: every participant holds one
 * RTCPeerConnection per other participant. Signaling rides the shared
 * WebSocket as `signal` messages ({ from, to, kind: "offer"|"answer"|"ice" }),
 * relayed verbatim by the server to the target user only.
 *
 * Who calls whom (no glare by construction):
 *   - When you JOIN a room, the server sends you `peers` (everyone already
 *     there). You are the INITIATOR toward each of them: `connectTo(peerId)`.
 *   - Existing members just see a `presence: joined` event and WAIT for your
 *     offer. Since exactly one side ever initiates, offers never collide.
 *
 * Fixed transceiver layout (the trick that avoids renegotiation):
 *   The initiator pre-adds THREE transceivers in a fixed order:
 *     [0] audio  = microphone
 *     [1] video  = camera
 *     [2] video  = screen share
 *   The offer therefore always negotiates these three m-lines. The answerer
 *   sees them in the same order via pc.getTransceivers() and attaches its own
 *   tracks by index. Toggling mic/cam/screen later is just
 *   sender.replaceTrack(trackOrNull) on the right slot — no new offer/answer
 *   round is ever needed, which keeps mesh state management simple.
 *
 * Per-connection lifecycle:
 *   initiator                         answerer
 *   ---------                        ---------
 *   addTransceiver x3
 *   attach local tracks
 *   createOffer / setLocal  --offer-->  setRemote
 *                                      attach local tracks to slots
 *                          <--answer--  createAnswer / setLocal
 *   setRemote
 *   (both) onicecandidate  <--ice-->   addIceCandidate  (trickle ICE; each
 *   candidate is sent as its own `signal` message; candidates arriving before
 *   the remote description are queued)
 *   (both) ontrack fires per slot -> classified by transceiver index into
 *   mic / camera / screen and surfaced to the UI.
 */

import type { SignalKind } from "./protocol";

export type TrackSlot = "mic" | "cam" | "screen";
const SLOTS: TrackSlot[] = ["mic", "cam", "screen"];

export interface RemoteMedia {
  mic: MediaStream | null;
  cam: MediaStream | null;
  screen: MediaStream | null;
}

const RTC_CONFIG: RTCConfiguration = {
  // STUN only, per project constraints (no TURN).
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

interface PeerState {
  pc: RTCPeerConnection;
  remote: RemoteMedia;
  /** ICE candidates that arrived before setRemoteDescription completed. */
  pendingIce: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
}

export class Mesh {
  private peers = new Map<string, PeerState>();
  private localTracks: Record<TrackSlot, MediaStreamTrack | null> = {
    mic: null,
    cam: null,
    screen: null,
  };

  constructor(
    /** Send a `signal` message over the shared WebSocket. */
    private sendSignal: (to: string, kind: SignalKind, payload: unknown) => void,
    /** A remote peer's media changed (track arrived/ended); re-render tiles. */
    private onRemoteMedia: (peerId: string, media: RemoteMedia) => void
  ) {}

  /** True if we already have a connection (in any state) to this peer. */
  has(peerId: string) {
    return this.peers.has(peerId);
  }

  private createPeerState(peerId: string): PeerState {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const state: PeerState = {
      pc,
      remote: { mic: null, cam: null, screen: null },
      pendingIce: [],
      hasRemoteDescription: false,
    };
    this.peers.set(peerId, state);

    // Trickle ICE: forward each candidate to the peer as it is discovered.
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(peerId, "ice", e.candidate.toJSON());
    };

    // Classify each incoming track by its transceiver's position in the fixed
    // [mic, cam, screen] layout and hand it to the UI.
    pc.ontrack = (e) => {
      const index = pc.getTransceivers().indexOf(e.transceiver);
      const slot = SLOTS[index];
      if (!slot) return;
      state.remote[slot] = new MediaStream([e.track]);
      // When the sender replaces a track with null (cam/screen off) the
      // receiver's track goes to muted; surface that so tiles can fall back
      // to the avatar placeholder.
      e.track.onmute = () => this.onRemoteMedia(peerId, state.remote);
      e.track.onunmute = () => this.onRemoteMedia(peerId, state.remote);
      this.onRemoteMedia(peerId, state.remote);
    };

    // If ICE fails outright (e.g. peer vanished without a leave), drop the
    // connection; presence handling will also call close() on explicit leaves.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") this.close(peerId);
    };

    return state;
  }

  /**
   * We just joined and `peerId` was already in the room: we are the initiator.
   * Pre-adds the fixed transceiver layout, attaches whatever local tracks we
   * currently have, and sends the offer.
   */
  async connectTo(peerId: string) {
    if (this.peers.has(peerId)) return;
    const { pc } = this.createPeerState(peerId);

    // Fixed slot order — this is what makes track classification work on both
    // ends without any extra signaling.
    pc.addTransceiver("audio", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    await this.attachLocalTracks(pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(peerId, "offer", offer);
  }

  /** Route an incoming `signal` message to the right handler. */
  async handleSignal(from: string, kind: SignalKind, payload: unknown) {
    try {
      if (kind === "offer") await this.handleOffer(from, payload as RTCSessionDescriptionInit);
      else if (kind === "answer") await this.handleAnswer(from, payload as RTCSessionDescriptionInit);
      else if (kind === "ice") await this.handleIce(from, payload as RTCIceCandidateInit);
    } catch (err) {
      console.error(`signal ${kind} from ${from} failed`, err);
    }
  }

  /** A newcomer is calling us: answer their offer. */
  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    // A fresh offer from a peer we already know means they rejoined; start clean.
    if (this.peers.has(from)) this.close(from);
    const state = this.createPeerState(from);
    const { pc } = state;

    await pc.setRemoteDescription(offer);
    state.hasRemoteDescription = true;

    // The offer created our transceivers in the initiator's fixed order.
    // Claim each slot for sending and attach our current local tracks.
    for (const t of pc.getTransceivers()) t.direction = "sendrecv";
    await this.attachLocalTracks(pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendSignal(from, "answer", answer);
    await this.flushPendingIce(state);
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const state = this.peers.get(from);
    if (!state) return;
    await state.pc.setRemoteDescription(answer);
    state.hasRemoteDescription = true;
    await this.flushPendingIce(state);
  }

  private async handleIce(from: string, candidate: RTCIceCandidateInit) {
    const state = this.peers.get(from);
    if (!state) return;
    // Candidates can outrace the offer/answer; buffer until the remote
    // description is in place, then flush.
    if (!state.hasRemoteDescription) state.pendingIce.push(candidate);
    else await state.pc.addIceCandidate(candidate);
  }

  private async flushPendingIce(state: PeerState) {
    while (state.pendingIce.length) {
      await state.pc.addIceCandidate(state.pendingIce.shift()!);
    }
  }

  /** Put our current local tracks onto a connection's fixed slots. */
  private async attachLocalTracks(pc: RTCPeerConnection) {
    const transceivers = pc.getTransceivers();
    for (let i = 0; i < SLOTS.length; i++) {
      const track = this.localTracks[SLOTS[i]];
      if (track && transceivers[i]) await transceivers[i].sender.replaceTrack(track);
    }
  }

  /**
   * Set (or clear) a local track on every peer connection. Because the slot
   * layout is fixed, this is a plain replaceTrack — no renegotiation.
   */
  async setLocalTrack(slot: TrackSlot, track: MediaStreamTrack | null) {
    this.localTracks[slot] = track;
    const index = SLOTS.indexOf(slot);
    await Promise.all(
      [...this.peers.values()].map((state) => {
        const t = state.pc.getTransceivers()[index];
        return t ? t.sender.replaceTrack(track) : Promise.resolve();
      })
    );
  }

  /** Tear down one peer (they left/disconnected): close pc, drop tiles. */
  close(peerId: string) {
    const state = this.peers.get(peerId);
    if (!state) return;
    this.peers.delete(peerId);
    state.pc.onicecandidate = null;
    state.pc.ontrack = null;
    state.pc.onconnectionstatechange = null;
    state.pc.close();
    this.onRemoteMedia(peerId, { mic: null, cam: null, screen: null });
  }

  /** Tear down everything (leaving the room). Local tracks are managed by the
   *  caller (they may survive a room switch). */
  closeAll() {
    for (const peerId of [...this.peers.keys()]) this.close(peerId);
  }
}
