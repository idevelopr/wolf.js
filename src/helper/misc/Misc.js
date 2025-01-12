import Base from '../Base.js';
import validator from '../../validator/index.js';
import { BlacklistLink, LinkMetadata, MessageSettings, WOLFAPIError } from '../../models/index.js';
import { Command, MessageFilterTier } from '../../constants/index.js';

class Misc extends Base {
  constructor (client) {
    super(client);

    this.blacklist = [];
    this.metadataResults = [];
  }

  async metadata (url) {
    if (validator.isNullOrUndefined(url)) {
      throw new WOLFAPIError('url cannot be null or empty', { url });
    } else if (typeof url !== 'string') {
      throw new WOLFAPIError('url must be type string', { url });
    }

    if (this.metadataResults.some((result) => this.client.utility.string.isEqual(result.url, url))) {
      return this.metadataResults.find((result) => this.client.utility.string.isEqual(result.url, url)).metadata;
    }

    const response = await this.client.websocket.emit(
      Command.METADATA_URL,
      {
        headers: {
          version: 2
        },
        body: {
          url
        }
      }
    );

    if (response.success) {
      const metadata = new LinkMetadata(this.client, response.body);

      this.metadataResults.push(
        {
          url,
          metadata
        }
      );

      response.body = metadata;
    }

    return response;
  }

  async linkBlacklist (forceNew = false) {
    if (!validator.isValidBoolean(forceNew)) {
      throw new WOLFAPIError('forceNew must be a valid boolean', { forceNew });
    }

    if (!forceNew && this.blacklist.length) {
      return this.blacklist;
    }

    const result = await this.client.websocket.emit(Command.METADATA_URL_BLACKLIST);

    this._blacklist = result.body?.map((item) => new BlacklistLink(this.client, item)) ?? [];

    return this._blacklist;
  }

  async getSecurityToken (requestNew = false) {
    if (!requestNew && this.cognito) {
      return this.client.cognito;
    }

    const response = await this.client.websocket.emit(Command.SECURITY_TOKEN_REFRESH);

    if (response.success) {
      this.client.cognito = response.body;
    } else {
      throw new WOLFAPIError(response.headers.message || 'Error occurred while requesting new security token');
    }

    return this.client.cognito;
  }

  async getMessageSettings () {
    const response = await this.client.websocket.emit(Command.MESSAGE_SETTING);

    return response.success ? new MessageSettings(this.client, response.body) : null;
  }

  async updateMessageSettings (messageFilterTier) {
    if (!validator.isValidNumber(messageFilterTier)) {
      throw new WOLFAPIError('messageFilterTier must be a valid number', { messageFilterTier });
    } else if (!Object.values(MessageFilterTier).includes(parseInt(messageFilterTier))) {
      throw new WOLFAPIError('messageFilterTier is not valid', { messageFilterTier });
    }

    return await this.client.websocket.emit(
      Command.MESSAGE_SETTING_UPDATE,
      {
        spamFilter: {
          enabled: messageFilterTier !== MessageFilterTier.OFF,
          tier: messageFilterTier
        }
      }
    );
  }

  _cleanUp (reconnection = false) {
    if (reconnection) {
      return Promise.resolve();
    }

    this._blacklist = [];
    this.metadataResults = [];
  }
}

export default Misc;
