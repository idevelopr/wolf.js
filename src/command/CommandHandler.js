import { CommandContext } from '../models/index.js';
import Command from './Command.js';
import { Privilege } from '../constants/index.js';
import WOLFAPIError from '../models/WOLFAPIError.js';

const checkForBotCharm = async (client, subscriber) => {
  const charmIds = client._frameworkConfig.charm.unofficial;

  if (subscriber.charms && subscriber.charms.selectedList.some((charm) => charmIds.includes(charm.charmId))) {
    return true;
  }

  if (subscriber.charmSummary) {
    return subscriber.charmSummary.some((charm) => charmIds.includes(charm.charmId));
  }
  subscriber.charmSummary = await client.charm.getSubscriberSummary(subscriber.id);

  return await checkForBotCharm(client, subscriber);
};

class CommandHandler {
  constructor (client) {
    this.client = client;
    this._commands = [];

    this.client.on('message', async (message) => {
      const commandSettings = client.config.framework.commands;

      if (!message.body || await this.client.banned.isBanned(message.sourceSubscriberId) || (message.sourceSubscriberId === this.client.currentSubscriber.id && client.config.framework.commands.ignore.self)) {
        return Promise.resolve();
      }

      const context = this._getCommand(
        this._commands,
        {
          isGroup: message.isGroup,
          argument: message.body,
          targetGroupId: message.targetGroupId,
          sourceSubscriberId: message.sourceSubscriberId,
          timestamp: message.timestamp,
          type: message.type
        }
      );

      if (!context.callback) {
        return Promise.resolve();
      }

      if (commandSettings.ignore.official || commandSettings.ignore.unofficial) {
        const subscriber = await this.client.subscriber.getById(context.sourceSubscriberId);

        if (commandSettings.ignore.official && await client.utility.subscriber.privilege.has(subscriber.id, Privilege.BOT)) {
          return Promise.resolve();
        }

        if (commandSettings.ignore.unofficial && !await client.utility.subscriber.privilege.has(subscriber.id, [Privilege.STAFF, Privilege.ENTERTAINER, Privilege.SELECTCLUB_1, Privilege.SELECTCLUB_2, Privilege.VOLUNTEER, Privilege.PEST, Privilege.GROUP_ADMIN, Privilege.ENTERTAINER, Privilege.RANK_1, Privilege.ELITECLUB_1, Privilege.ELITECLUB_2, Privilege.ELITECLUB_3, Privilege.BOT, Privilege.BOT_TESTER, Privilege.CONTENT_SUBMITER, Privilege.ALPHA_TESTER, Privilege.TRANSLATOR]) && await checkForBotCharm(this.client, subscriber)) {
          return Promise.resolve();
        }
      }

      const callback = context.callback;

      Reflect.deleteProperty(context, 'callback');

      return callback.call(this, new CommandContext(this.client, context));
    });
  }

  register (commands) {
    commands = Array.isArray(commands) ? commands : [commands];

    if (commands.length === 0) {
      throw new WOLFAPIError('commands cannot be an empty array', { commands });
    }

    this._commands = commands;
  }

  isCommand (message) {
    return this._commands.some((command) => this.client.phrase.getAllByName(command.phraseName).some((phrase) => this.client.utility.string.isEqual(phrase.value, message?.split(this.client.SPLIT_REGEX).filter(Boolean)[0])));
  }

  _getCommand (commands, context) {
    const command = commands.find((command) => {
      const phrase = this.client.phrase.getAllByName(command.phraseName).find((phrase) => this.client.utility.string.isEqual(phrase.value, context.argument.split(this.client.SPLIT_REGEX)[0]));

      if (phrase && (command.commandCallbackTypes.includes(Command.getCallback.BOTH) || (context.isGroup && command.commandCallbackTypes.includes(Command.getCallback.GROUP)) || (!context.isGroup && command.commandCallbackTypes.includes(Command.getCallback.PRIVATE)))) {
        context.argument = context.argument.substr(phrase.value.length).trim();
        context.language = context.language || phrase.language;
        context.callback = command.commandCallbackTypes.includes(Command.getCallback.BOTH) ? command.callbackObject.both : !context.isGroup ? command.callbackObject.private : command.callbackObject.group;

        return command;
      }

      return false;
    });

    return (!command || command.children.length === 0) ? context : this._getCommand(command.children, context);
  }
}

export default CommandHandler;
