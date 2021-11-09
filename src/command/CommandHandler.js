'use strict';
const { privilege, messageType } = require('@dawalters1/constants');
const { internal } = require('../constants');
const Command = require('./Command');

/**
 * Flags that unofficial bots should never have, check their profile before requesting summary
 */
const ignoreTagList = [
  privilege.STAFF,
  privilege.ENTERTAINER,
  privilege.SELECTCLUB_1,
  privilege.SELECTCLUB_2,
  privilege.VOLUNTEER,
  privilege.PEST,
  privilege.GROUP_ADMIN,
  privilege.ENTERTAINER,
  privilege.ELITECLUB_1,
  privilege.ELITECLUB_2,
  privilege.ELITECLUB_3,
  privilege.BOT,
  privilege.BOT_TESTER,
  privilege.CONTENT_SUBMITER,
  privilege.ALPHA_TESTER,
  privilege.TRANSLATOR
];

/**
 * {@hideconstructor}
 */
module.exports = class CommandHandler {
  constructor (api) {
    this._api = api;
    this._commands = [];

    console.log(this._api);

    this._api.on(internal.GROUP_MESSAGE, async message => await this._processMessage(message));
    this._api.on(internal.PRIVATE_MESSAGE, async message => await this._processMessage(message));
  }

  isCommand (message) {
    return this._commands.find((command) => {
      if (this._api.phrase().isRequestedPhrase(command.trigger, message.body.split(/[\s]+/)[0])) {
        const commandCallbacks = command.commandCallbackTypes;

        // Check to see if the command is valid for the message type
        if (commandCallbacks.includes(Command.getCallback.BOTH) || (message.isGroup && commandCallbacks.includes(Command.getCallback.GROUP)) || (!message.isGroup && commandCallbacks.includes(Command.getCallback.PRIVATE))) {
          return true;
        }
      }
      return false;
    }) !== undefined;
  }

  register (commands) {
    this._commands = commands;
  }

  async _processMessage (message) {
    try {
      if (!message.body || message.type !== messageType.TEXT_PLAIN || message.sourceSubscriberId === this._api.currentSubscriber.id || this._api.banned().isBanned(message.sourceSubscriberId)) {
        return Promise.resolve();
      }

      const commandContext = {
        isGroup: message.isGroup,
        language: null,
        argument: message.body,
        message,
        targetGroupId: message.targetGroupId,
        sourceSubscriberId: message.sourceSubscriberId,
        timestamp: message.timestamp,
        type: message.type
      };

      const commandCollection = this._commands.find((command) => {
        const match = this._api.phrase().getAllByName(command.trigger).find(phrase => phrase.value.toLowerCase() === commandContext.argument.split(/[\s]+/)[0].toLowerCase());

        if (match) {
          if (command.commandCallbackTypes.includes(Command.getCallback.BOTH) ||
        (commandContext.isGroup && command.commandCallbackTypes.includes(Command.getCallback.GROUP)) ||
        (!commandContext.isGroup && command.commandCallbackTypes.includes(Command.getCallback.PRIVATE))) {
            commandContext.argument = commandContext.argument.substr(match.value.length).trim();
            commandContext.language = match.language;
            commandContext.callback = command.commandCallbackTypes.includes(Command.getCallback.BOTH) ? command.commandCallbacks.both : !commandContext.isGroup ? command.commandCallbacks.private : command.commandCallbacks.group;
            return command;
          }
        }

        return false;
      });

      if (!commandCollection || (this._api.options.ignoreOfficialBots && await this._api.utility().subscriber().privilege().has(message.sourceSubscriberId, privilege.BOT)) || (this._api.options.ignoreUnofficialBots && !await this._api.utility().subscriber().privilege().has(message.sourceSubscriberId, ignoreTagList) && await this._api.utility().subscriber().hasCharm(message.sourceSubscriberId, [813, 814]))) {
        return Promise.resolve();
      }

      const command = this._getCurrentOrChildCommand(commandCollection, commandContext);

      const callback = command.callback;

      Reflect.deleteProperty(command, 'callback');

      return callback.call(this, command);
    } catch (error) {
      error.message = `Error handling ${message.isGroup ? 'Group' : 'Private'} Command!\nMessage: ${JSON.stringify(message, null, 4)}\nData: ${error.method}\n${error.toString()}`;
      throw error;
    }
  }

  _getCurrentOrChildCommand (parentCommand, commandContext) {
    if (!commandContext.argument) {
      return commandContext;
    }

    const command = parentCommand.children.find((child) => {
      const match = this._api.phrase().getAllByName(child.trigger).find(phrase => phrase.value.toLowerCase() === commandContext.argument.split(/[\s]+/)[0].toLowerCase());

      if (match) {
        if (child.commandCallbackTypes.includes(Command.getCallback.BOTH) || (commandContext.isGroup && child.commandCallbackTypes.includes(Command.getCallback.GROUP)) || (!commandContext.isGroup && child.commandCallbackTypes.includes(Command.getCallback.PRIVATE))) {
          commandContext.argument = commandContext.argument.substr(match.value.length).trim();
          commandContext.callback = child.commandCallbackTypes.includes(Command.getCallback.BOTH) ? child.commandCallbacks.both : !commandContext.isGroup ? child.commandCallbacks.private : child.commandCallbacks.group;
          return child;
        }
      }

      return false;
    });

    if (!command || command.children.length === 0) {
      return commandContext;
    }

    return this._getCurrentOrChildCommand(command, commandContext);
  }
};
