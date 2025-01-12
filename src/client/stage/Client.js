import { Event, StageBroadcastState, StageConnectionState } from '../../constants/index.js';
import events from 'events';
import wrtc from 'wrtc';
import ffmpeg from 'fluent-ffmpeg';
import _ from 'lodash';
import WOLFAPIError from '../../models/WOLFAPIError.js';

const EventEmitter = events.EventEmitter;
const { RTCSessionDescription, RTCPeerConnection, nonstandard } = wrtc;
const { RTCAudioSource } = nonstandard;
const MediaStream = wrtc.MediaStream;

const SAMPLE_RATE = 48000;
const SLICE_COUNT = 1920;
const CHANNEL_COUNT = 2;
const BITRATE = 16;
const FRAMES = 480;

const createUInt8Array = (buffer, volume) => {
  for (let i = buffer.length; i < 1920; i++) {
    buffer[i] = 0;
  }

  return new Int8Array(buffer).map((samples) => (volume === 1 || !samples) ? samples : samples * volume);
};

class Client extends EventEmitter {
  /**
   * @param {import('../WOLF').default} client
   */
  constructor (client) {
    super();

    this.client = client;

    this.slotId = undefined;
    this.muted = undefined;

    this.broadcastState = StageBroadcastState.IDLE;
    this.connectionState = StageConnectionState.DISCONNECTED;
    this.client = new RTCPeerConnection();
    this.source = new RTCAudioSource();

    const stream = new MediaStream();

    this.track = this.source.createTrack();
    stream.addTrack(this.track);
    this.sender = this.client.addTrack(this.track, stream);

    this.completed = false;
    this.samples = [];
    this.emittedPlaying = false;
    this.duration = 0;
    this.volume = 1;

    const broadcast = () => setTimeout(async () => {
      if (this.broadcastState === StageBroadcastState.PLAYING) {
        const sample = this.samples?.shift();

        if (sample) {
          if (!this.muted) {
            this.source.onData(
              {
                samples: createUInt8Array(sample, this.volume),
                sampleRate: SAMPLE_RATE,
                bitsPerSample: BITRATE,
                channelCount: CHANNEL_COUNT,
                numberOfFrames: FRAMES,
                timestamp: Date.now()
              }
            );
          }
        }

        if (!this.emittedPlaying) {
          this.emittedPlaying = true;
          this.emit(Event.STAGE_CLIENT_START);
        } else if (!this.samples.length) {
          if (this.completed) {
            this.emit(Event.STAGE_CLIENT_END);
            this.stop();
          }
        }
      }

      return broadcast();
    }, 9.9);

    this.client.onconnectionstatechange = async () => {
      const state = this.client.connectionState;

      if (state === StageConnectionState.CONNECTED) {
        if (this.connectionState === StageConnectionState.INITIALISING || this.connectionState === StageConnectionState.DISCONNECTED) {
          this.connectionState = StageConnectionState.CONNECTING;
        } else if (this.connectionState === StageConnectionState.CONNECTING) {
          this.connectionState = StageConnectionState.CONNECTED;
        }
      } else if (this.client.connectionState === StageConnectionState.DISCONNECTED) {
        this.connectionState = StageConnectionState.DISCONNECTED;

        return this.reset(true);
      } else {
        return Promise.resolve();
      }

      return this.emit(this.connectionState === StageConnectionState.CONNECTED ? Event.STAGE_CLIENT_CONNECTED : this.connectionState === StageConnectionState.CONNECTING);
    };

    broadcast();
  }

  handleSlotUpdate (slot, sourceSubscriberId) {
    if (slot.occupierId !== null) {
      if ((this.muted && !slot.occupierMuted) || (!this.muted && slot.occupierMuted)) {
        this.muted = slot.occupierMuted;
        this.emit(slot.occupierMuted ? Event.STAGE_CLIENT_MUTED : Event.STAGE_CLIENT_UNMUTED, { sourceSubscriberId });
      } else if (slot.locked) {
        this.reset(true);
      } else if (this.connectionState !== StageConnectionState.READY && slot.connectionState === StageConnectionState.CONNECTED.toUpperCase()) {
        this.connectionState = StageConnectionState.READY;
        this.emit(Event.STAGE_CLIENT_READY);
      }
    } else {
      this.reset(true);

      this.emit(sourceSubscriberId !== undefined ? Event.STAGE_CLIENT_KICKED : Event.STAGE_CLIENT_DISCONNECTED, { sourceSubscriberId });
    }
  }

  reset (disconnect = false) {
    this.broadcastState = this.broadcastState === StageBroadcastState.PAUSED ? this.broadcastState : StageBroadcastState.IDLE;

    clearInterval(this.durationUpdater);

    this.ffmpeg?.destroy();
    this.completed = false;
    this.samples = [];
    this.emittedPlaying = false;
    this.duration = 0;

    if (disconnect) {
      this.connectionState = StageConnectionState.DISCONNECTED;

      this.client.close();

      this.emit(Event.STAGE_CLIENT_DISCONNECTED);
    }
  }

  setVolume (volume) {
    if (volume < 0 || volume > 2) {
      throw new WOLFAPIError('volume cannot be less than 0 or greater than 2', { volume });
    }

    this.volume = parseFloat(volume.toPrecision(3));

    return this.volume;
  }

  play (data) {
    this.reset();

    this.ffmpeg = ffmpeg(data)
      .toFormat('wav')
      .native()
      .noVideo()
      .on('error', (error) => {
        data?.destroy();

        if (this.broadcastState === StageBroadcastState.IDLE) {
          return Promise.resolve();
        }

        this.reset();

        this.emit(Event.STAGE_CLIENT_ERROR, error);
      })
      .pipe()
      .on('data', async (data) => _.chunk(data, SLICE_COUNT).forEach(async (chunk) => this.samples.push(chunk)))
      .on('finish', () => { this.completed = true; });

    this.broadcastState = this.broadcastState === StageBroadcastState.PAUSED ? StageBroadcastState.PAUSED : StageBroadcastState.PLAYING;

    this.durationUpdater = setInterval(() => {
      if (this.broadcastState === StageBroadcastState.PLAYING) {
        this.duration += 1000;
      }

      return Promise.resolve();
    }, 1000);
  }

  stop () {
    this.reset();

    return this.emit(Event.STAGE_CLIENT_STOPPED);
  }

  pause () {
    this.broadcastState = StageBroadcastState.PAUSED;
  }

  resume () {
    this.broadcastState = this.ffmpeg ? StageBroadcastState.PLAYING : StageBroadcastState.IDLE;
  }

  async createSDP () {
    const offer = await this.client.createOffer(
      {
        offerToSendAudio: true,
        offerToSendVideo: false,
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      }
    );

    this.client.setLocalDescription(offer);

    return offer.sdp.replace('a=sendrecv', 'a=recvonly');
  }

  async setResponse (slotId, sdp) {
    this.slotId = slotId;

    this.client.setRemoteDescription(
      new RTCSessionDescription(
        {
          type: 'answer',
          sdp
        }
      )
    );
  }
}

export default Client;
