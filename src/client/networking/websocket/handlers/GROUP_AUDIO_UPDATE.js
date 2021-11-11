const { events } = require('../../../../constants');

module.exports = async (api, body) => {
  const group = api.group()._groups.find((group) => group.id === body.id);

  if (!group) {
    return Promise.resolve();
  }

  const cached = group.audioConfig;

  group.audioConfig = body;

  return api.emit(
    events.GROUP_AUDIO_UPDATE,
    {
      old: cached,
      new: body
    }
  );
};
