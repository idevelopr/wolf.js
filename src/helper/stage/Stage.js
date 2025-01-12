import WOLFAPIError from '../../models/WOLFAPIError.js';
import Base from '../Base.js';
import Request from './Request.js';
import Slot from './Slot.js';
import StageClient from '../../client/stage/Client.js';
import { Command, Event, StageBroadcastState, StageConnectionState } from '../../constants/index.js';
import validator from '../../validator/index.js';
import models, { StageClientDurationUpdate, StageClientGeneralUpdate, StageClientViewerCountUpdate } from '../../models/index.js';
import commandExists from 'command-exists-promise';

class Stage extends Base {
  constructor (client) {
    super(client);

    this.request = new Request(this.client);
    this.slot = new Slot(this.client);

    this.clients = {};

    this.client.on('groupAudioCountUpdate', (oldCount, newCount) => {
      if (!this.clients[newCount.id]) {
        return Promise.resolve();
      }

      return this.client.emit(
        Event.STAGE_CLIENT_VIEWER_COUNT_CHANGED,
        new StageClientViewerCountUpdate(
          this.client,
          {
            targetChannelId: oldCount.id,
            oldBroadcastCount: oldCount.broadcasterCount,
            newBroadcasterCount: newCount.broadcasterCount,
            oldConsumerCount: oldCount.consumerCount,
            newConsumerCount: newCount.consumerCount
          }
        )
      );
    });

    this.client.on('groupAudioSlotUpdate', (oldSlot, newSlot) => {
      const client = this.clients[newSlot.id];

      if (client?.slotId !== newSlot.slot.id) {
        return Promise.resolve();
      }

      return client.handleSlotUpdate(newSlot.slot, newSlot.sourceSubscriberId);
    });
  }

  async _getClient (targetChannelId, createIfNotExists = false) {
    if (this.clients[targetChannelId]) {
      return this.clients[targetChannelId];
    }

    if (!await commandExists('ffmpeg')) {
      throw new WOLFAPIError('ffmpeg must be installed on this device to create or use a stage client', { download: 'https://ffmpeg.org/download.html' });
    }

    if (createIfNotExists) {
      const client = new StageClient();

      client.on(Event.STAGE_CLIENT_CONNECTING, (data) => this.client.emit(Event.STAGE_CLIENT_CONNECTING, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_CONNECTED, (data) => this.client.emit(Event.STAGE_CLIENT_CONNECTED, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_DISCONNECTED, async (data) => {
        this._deleteClient(targetChannelId);
        this.client.emit(Event.STAGE_CLIENT_DISCONNECTED, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId }));
      });
      client.on(Event.STAGE_CLIENT_KICKED, async (data) => {
        this._deleteClient(targetChannelId);
        this.client.emit(Event.STAGE_CLIENT_KICKED, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId }));
      });
      client.on(Event.READY, (data) => this.client.emit(Event.READY, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_ERROR, (data) => this.client.emit(Event.STAGE_CLIENT_ERROR, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_END, (data) => this.client.emit(Event.STAGE_CLIENT_END, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_STOPPED, (data) => this.client.emit(Event.STAGE_CLIENT_STOPPED, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_MUTED, (data) => this.client.emit(Event.STAGE_CLIENT_MUTED, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_UNMUTED, (data) => this.client.emit(Event.STAGE_CLIENT_UNMUTED, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_START, (data) => this.client.emit(Event.STAGE_CLIENT_START, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_READY, (data) => this.client.emit(Event.STAGE_CLIENT_READY, new StageClientGeneralUpdate(this.client, { ...data, targetChannelId })));
      client.on(Event.STAGE_CLIENT_DURATION, (data) => this.client.emit(Event.STAGE_CLIENT_DURATION, new StageClientDurationUpdate(this.client, { ...data, targetChannelId })));

      this.clients[targetChannelId] = client;
    }

    return this.clients[targetChannelId];
  }

  _deleteClient (targetChannelId) {
    this.clients[targetChannelId]?.stop();

    Reflect.deleteProperty(this.clients, targetChannelId);
  }

  async getAudioConfig (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    const channel = await this.client.channel.getById(targetChannelId);

    if (!channel.exists) {
      throw new models.WOLFAPIError('Channel does not exist', { targetChannelId });
    }

    return channel.audioConfig;
  }

  async updateAudioConfig (targetChannelId, { stageId, enabled, minRepLevel }) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (stageId) {
      if (!validator.isValidNumber(stageId)) {
        throw new models.WOLFAPIError('stageId must be a valid number', { stageId });
      } else if (validator.isLessThanZero(stageId)) {
        throw new models.WOLFAPIError('stageId cannot be less than 0', { stageId });
      }
    }

    if (enabled && !validator.isValidBoolean(enabled)) {
      throw new models.WOLFAPIError('enabled must be a valid boolean', { enabled });
    }

    if (minRepLevel) {
      if (!validator.isValidNumber(minRepLevel)) {
        throw new models.WOLFAPIError('minRepLevel must be a valid number', { minRepLevel });
      } else if (validator.isLessThanZero(minRepLevel)) {
        throw new models.WOLFAPIError('minRepLevel cannot be less than 0', { minRepLevel });
      }
    }

    const audioConfig = await this.client.channel.getById(targetChannelId);

    return await this.client.websocket.emit(
      Command.GROUP_AUDIO_UPDATE,
      {
        id: parseInt(targetChannelId),
        stageId: parseInt(stageId) || audioConfig.stageId,
        enabled: enabled || audioConfig.enabled,
        minRepLevel: parseInt(minRepLevel) || audioConfig.minRepLevel
      }
    );
  }

  async getAudioCount (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    const channel = await this.client.channel.getById(targetChannelId);

    if (!channel.exists) {
      throw new models.WOLFAPIError('Channel does not exist', { targetChannelId });
    }

    return channel.audioCounts;
  }

  async play (targetChannelId, data) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].play(data);
  }

  async stop (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].stop();
  }

  async pause (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].pause();
  }

  async resume (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].resume();
  }

  async getBroadcastState (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].broadcastState;
  }

  async onStage (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    return !!this.clients[targetChannelId];
  }

  async isReady (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].connectionState === StageConnectionState.READY;
  }

  async isPlaying (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    return await this.getBroadcastState(targetChannelId) === StageBroadcastState.PLAYING;
  }

  async isPaused (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    return await this.getBroadcastState(targetChannelId) === StageBroadcastState.PAUSED;
  }

  async isIdle (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    return await this.getBroadcastState(targetChannelId) === StageBroadcastState.IDLE;
  }

  async duration (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].duration;
  }

  async getVolume (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].volume;
  }

  async setVolume (targetChannelId, volume) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    if (validator.isNullOrUndefined(volume)) {
      throw new models.WOLFAPIError('volume cannot be null or undefined', { volume });
    } else if (!validator.isValidNumber(volume, true)) {
      throw new models.WOLFAPIError('volume must be a valid number', { volume });
    } else if (validator.isLessThanZero(volume)) {
      throw new models.WOLFAPIError('volume cannot be less than 0', { volume });
    }

    return await this.clients[targetChannelId].setVolume(volume);
  }

  async getSlotId (targetChannelId) {
    if (validator.isNullOrUndefined(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be null or undefined', { targetChannelId });
    } else if (!validator.isValidNumber(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId must be a valid number', { targetChannelId });
    } else if (validator.isLessThanOrEqualZero(targetChannelId)) {
      throw new models.WOLFAPIError('targetChannelId cannot be less than or equal to 0', { targetChannelId });
    }

    if (!this.clients[targetChannelId]) {
      throw new WOLFAPIError('bot is not on stage', { targetChannelId });
    }

    return await this.clients[targetChannelId].slotId;
  }

  _cleanUp (reconnection = false) {
    if (reconnection) {
      return Promise.resolve();
    }

    Object.keys(this.clients).forEach((targetChannelId) => this._deleteClient(targetChannelId));
    this.request._cleanUp(reconnection);
    this.slot._cleanUp(reconnection);
  }
}

export default Stage;
