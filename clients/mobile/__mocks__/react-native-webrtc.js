// Mock for react-native-webrtc used in Jest tests.
// The real library requires native modules unavailable in the Node test env.

class RTCPeerConnection {
  constructor() {
    this.localDescription = null;
    this.remoteDescription = null;
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
  }

  addTrack() {}

  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "mock-sdp-offer" });
  }

  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "mock-sdp-answer" });
  }

  setLocalDescription(desc) {
    this.localDescription = desc;
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    return Promise.resolve();
  }

  addIceCandidate(candidate) {
    return Promise.resolve();
  }

  close() {
    this.connectionState = "closed";
  }
}

class RTCSessionDescription {
  constructor(init) {
    this.type = init.type;
    this.sdp = init.sdp;
  }
}

class RTCIceCandidate {
  constructor(init) {
    this.candidate = init.candidate;
    this.sdpMid = init.sdpMid || null;
    this.sdpMLineIndex = init.sdpMLineIndex ?? null;
  }
}

const mediaDevices = {
  getUserMedia: jest.fn(() =>
    Promise.resolve({
      getTracks: () => [{ kind: "audio", stop: jest.fn() }],
      getAudioTracks: () => [{ kind: "audio", stop: jest.fn() }],
    }),
  ),
};

module.exports = {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
};
