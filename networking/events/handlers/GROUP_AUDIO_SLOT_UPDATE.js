const BaseEvent = require('../BaseEvent');

/**
 * {@hideconstructor}
 */
module.exports = class GroupAudioSlotUpdate extends BaseEvent {
  async process (data) {
    this._api.on._emit(this._command, this._api.stage()._process(data));
  }
};
