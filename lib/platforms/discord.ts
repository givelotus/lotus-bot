import { EventEmitter } from "node:stream";
import {
  REST,
  Routes,
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ColorResolvable,
  Partials,
  ActivityType,
  Message,
  ChannelType
} from 'discord.js';
import { BOT } from '../../util/constants';
import { format } from 'node:util';
import { Platform } from '.';
import config from '../../config';

// DM Branding
const primaryColor: ColorResolvable = 0xa02fe4;
const secondaryColor: ColorResolvable = 0xf0409b;

export type DiscordMessage = ChatInputCommandInteraction | Message;

type Command = {
  name: string,
  description: string,
  options?: CommandOption[]
};

type CommandOption = {
  type: number,
  name: string,
  description: string,
  required: boolean
};

export class Discord 
extends EventEmitter
implements Platform {
  private lastReplyTime: number;
  private clientId: string;
  private guildIds: string[];
  private client: Client;
  private commands: Command[] = [];
  private activities: string[] = [];
  private activityInterval: NodeJS.Timer;

  constructor() {   
    super();
    // Discord bot client and api setup
    this.clientId = config.discord.clientId;
    this.guildIds = config.discord.guildId.split(",");
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel]
    });
    this.activities.push(
      "🪷 Give appreciation with Lotus 🪷",
      "🪷 givelotus.org 🪷",
      "🪷 Use /balance to start 🪷"
    );
  };
  /**
   * Instantiate the bot with API key. Also set up event handlers.
   * @param key - API key, as String
   */
  setup = async (apiKey: string) => {
    //Command JSON for Discord Command Registration Type 10 is number, 3 is string?
    this.commands = [
      {
        name: 'give',
        description: 'Give XPI to another user.',
        options: [
          {
            type: 6,
            name: "to",
            description: "User to give XPI to",
            required: true
          },
          {
            type: 10,
            name: "amount",
            description: "Amount of XPI to give.",
            required: true
          }
        ]
      },
      {
        name: 'balance',
        description: 'Get balance information for the currently logged in user.'
      },
      {
        name: 'deposit',
        description: 'Deposit XPI into your wallet in the bot.'
      },
      {
        name: 'withdraw',
        description: 'Withdraw XPI from your wallet in the bot.',
        options: [
          {
            type: 10,
            name: "amount",
            description: "Amount of XPI to withdraw.",
            required: true
          },
          {
            type: 3,
            name: "address",
            description: "XPI Address for your external wallet.",
            required: true
          }
        ]
      },
      {
        name: 'link',
        description: 'Link your account to another Discord/platform account',
        options: [
          {
            type: 3,
            name: 'secret',
            description: 'Optional - Secret provided from another account',
            required: false
          }
        ],
      },
      {
        name: 'ping',
        description: 'pong'
      },
      {
        name: 'ilovelotus',
        description: 'I 💖 🪷'
      },
    ];
    try {
      this.client.on('ready', this._handleReady);
      this.client.on('messageCreate', this._handleDirectMessage);
      this.client.on('interactionCreate', this._handleCommandMessage);
      this.client.token = apiKey;
      this.client.rest = new REST({ version: '10' }).setToken(apiKey);
    } catch (e: any) {
      throw new Error(`setup: ${e.message}`);
    }

  };
  /** Activate the bot */
  launch = async () => {
    for (const guildId of this.guildIds) {
      await this._registerCommands(guildId);
    }
    await this.client.login();
    await this.client.user.fetch();
  };
  /** Deactivate the bot */
  stop = async () => {
    clearInterval(this.activityInterval);
    this.client.destroy();
  };
  getBotId = () => this.clientId;
  sendBalanceReply = async (
    platformId: string,
    balance: string,
    interaction: ChatInputCommandInteraction
  ) => {
    try {
      await interaction.reply({
        content: format(BOT.MESSAGE.BALANCE, balance),
        ephemeral: true
      });
    } catch (e: any) {
      throw new Error(`sendBalanceReply: ${e.message}`);
    }
  };
  sendDepositReply = async (platformId: string, address: string) => {
    try {
      const depositReplyEmbed = new EmbedBuilder()
        .setColor(primaryColor)
        .setTitle(`View address on the Explorer`)
        .setURL(`${config.wallet.explorerUrl}/address/${address}`)
        .setDescription('Send Lotus here to fund your account')
        .addFields({ name: 'Lotus Address', value: address })
        .setImage(`${config.wallet.explorerUrl}/qr/${address}`);

      const userObj = await this.client.users.fetch(platformId);
      await userObj.send({embeds: [depositReplyEmbed]});
    } catch (e: any) {
      throw new Error(`sendDepositReply: ${e.message}`);
    }
  };
  sendDepositReceived = async (
    platformId: string,
    txid: string,
    amount: string,
    balance: string,
  ) => {
    try {
      const embedMessage = new EmbedBuilder()
        .setColor(primaryColor)
        .setTitle('Deposit Received 🪷 - Click Here to see the tx.')
        .setURL(`${config.wallet.explorerUrl}/tx/${txid}`)
        .setDescription(
          `I received your deposit of ${amount} XPI. ` +
          `Your balance is now ${balance} XPI.`
        );
      const userObj = await this.client.users.fetch(platformId);
      await userObj.send({ embeds: [embedMessage] });
    } catch (e: any) {
      throw new Error(`sendDepositReceived: ${e.message}`);
    }
  };

  sendGiveReply = async (
    chatId: string,
    replyToMessageId: number,
    fromUsername: string,
    toUsername: string,
    txid: string,
    amount: string,
    interaction: ChatInputCommandInteraction
  ) => {
    try {
      const { user, options } = interaction;
      const fromUser = `<@${user.id}>`;
      const toUser = `<@${options.getUser('to').id}>`;
      const giveReplyEmbed = new EmbedBuilder()
        .setColor(primaryColor)
        .setTitle(`🪷 Click Here to see the tx 🪷`)
        .setURL(`${config.wallet.explorerUrl}/tx/${txid}`)
        .setDescription(`${fromUser}, you have given ${amount} XPI to ${toUser}! 🪷`);
        //.addFields({ name: 'From', value: `${fromUser}` })
        //.addFields({ name: 'To', value: `${toUser}` });
      await interaction.reply({embeds: [giveReplyEmbed]});
    } catch (e: any) {
      throw new Error(`sendGiveReply: ${e.message}`);
    }
  };
  sendWithdrawReply = async (
    platformId: string,
    {
      txid,
      amount,
      error
    }: {
      txid?: string,
      amount?: string,
      error?: string
    }
  ) => {
    try {
      const userObj = await this.client.users.fetch(platformId);
      if (error) {
        await userObj.send(format(BOT.MESSAGE.WITHDRAW_FAIL, error));
        return;
      }
      const embedMessage = new EmbedBuilder()
        .setColor(secondaryColor)
        .setTitle('Withdrawal Successful 🪷 - Click Here to see the tx.')
        .setURL(`${config.wallet.explorerUrl}/tx/${txid}`)
        .setDescription(`Your withdrawal of ${amount} XPI was successful!`);

      await userObj.send({embeds: [embedMessage]});
    } catch (e: any) {
      throw new Error(`sendWithdrawReply: ${e.message}`);
    }
  };
  sendLinkReply = async (
    platformId: string,
    { error, secret }: { error?: string, secret?: string },
    interaction: DiscordMessage
  ) => {
    try {
      switch (typeof secret) {
        case 'string':
          const msg = format(BOT.MESSAGE.LINK, secret);
          await interaction.reply({
            content: msg,
            ephemeral: true
          });
          break;
        case 'undefined':
          await interaction.reply({
            content: error
              ? format(BOT.MESSAGE.LINK_FAIL, error)
              : BOT.MESSAGE.LINK_OK,
            ephemeral: true
          });
          break;
      }
    } catch (e: any) {
      throw new Error(`sendLinkReply: ${e.message}`);
    }
  };
  private _registerCommands = async (guildId: string) => {
    try {
      await this.client.rest.put(
        Routes.applicationGuildCommands(this.clientId, guildId),
        { body: this.commands },
      );
    } catch (e: any) {
        // And of course, make sure you catch and log any errors!
        throw new Error(`_registerCommands: ${e.message}`);
    }
  };
  private _handleReady = () => {
    this._setRandomActivity();
    this.activityInterval = setInterval(this._setRandomActivity, 10000);
  };
  private _handleDirectMessage = async (message: Message) => {
    const {
      author,
      content
    } = message;

    if (author.id == this.clientId || message.channel.type != ChannelType.DM) {
      return;
    }
    const words = content.trim().split(" ");
    const command = words[0];
    const amount = Number(words[1]);
    const secret = words[1];
    const wAddress = words[2] || null;
    switch (command) {
      case "balance":
        this.emit('Balance', 'discord', author.id, message);
        break;
      case "deposit":
        this.emit('Deposit', 'discord', author.id);
        break;
      case "withdraw":
        if (words.length < 3) {
          await message.reply(
            `You must use the following syntax for withdrawing:\r\n` +
            "`withdraw <amount> <external_address>`"
          );
          break;
        }
        if (isNaN(amount) || amount <= 0) {
          await message.reply("The value for withdrawal must be greater than 0.");
          break;
        }
        this.emit('Withdraw', 'discord', author.id, amount, wAddress);
        break;
      case 'link':
        this.emit('Link', 'discord', author.id, secret, message);
        break;
      default:
        message.reply(
          `You can only use the following verbs in my DMs:\r\n\r\n` +
          `**balance** - Get your current balance in the bot.\r\n` +
          `**deposit** - Get the address needed to deposit XPI.\r\n` +
          `**withdraw** - Withdraw XPI to an external wallet.\r\n` +
          '**link** - Link to another account/platform\r\n\r\n' +
          "withdraw command syntax: `withdraw <amount> <external_address>`\r\n" +
          "link command syntax:\r\n" +
          "```link <secret code> - Link using code from other acocunt\r\n" +
          "link - Get your code for linking account on another platform```"
        );
        break;
    }
  }
  private _handleCommandMessage = async (
    interaction: ChatInputCommandInteraction
  ) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const {
      user,
      channelId,
      options,
      commandName
    } = interaction;
    const fromUser = `${user.username}#${user.discriminator}`;
    const platformId = user.id;
    // console.log(
    //   `Command sent from ${fromUser} on channel ` +
    //   `${this.guildId}:${channelId} = ${commandName}`
    // );
    const xpiAmount = options.getNumber('amount') ?? 0;

    try {
      switch (commandName) {
        case "give":
          //Process give shit.
          const to = options.getUser('to');
          const toId = to.id
          const toUsername = `${to.username}#${to.discriminator}`;
          if (xpiAmount <= 0) {
            await interaction.reply({
              content: format(BOT.MESSAGE.ERR_AMOUNT_INVALID, xpiAmount),
              ephemeral: true
            });
            break;
          }
          // can't send to self
          if (platformId == toId) {
            await interaction.reply({
              content: BOT.MESSAGE.ERR_MUST_GIVE_TO_OTHER_USER,
              ephemeral: true
            });
            break;
          }
          if (this.clientId == to.id) {
            await interaction.reply({
              content: format(BOT.MESSAGE.ERR_GIVE_TO_BOT),
              ephemeral: true
            });
            break;
          }
          this.emit(
            'Give',
            'discord', 
            null,
            null,
            platformId,
            fromUser,
            toId,
            toUsername,
            xpiAmount.toString(),
            interaction
          );
          break;
        case "balance":
          this.emit('Balance', 'discord', platformId, interaction);
          break;
        case "deposit":
          this.emit('Deposit', 'discord', platformId);
          await interaction.reply({
            content: `Please check your DMs for reply message.`,
            ephemeral: true
          });
          break;
        case "withdraw":
          this.emit(
            'Withdraw',
            'discord',
            platformId,
            xpiAmount.toString(),
            options.getString("address")
          );
          await interaction.reply({
            content: `Please check your DMs for reply message.`,
            ephemeral: true
          });
          break;
        case 'link':
          const secret = options.getString('secret') || undefined;
          this.emit('Link', 'discord', platformId, secret, interaction);
          break;
        case "ping":
          await interaction.reply({ content: `Pong! 🏓` });
          break;
        case "ilovelotus":
          await interaction.reply({ content: `👁️ 💖 🪷!` });
          break;
        default:
          //This should NEVER happen as we are registering commands directly to the server.
          await interaction.reply({
            content: 'The command you entered does not exist!',
            ephemeral: true
          });
          break;
      }
    } catch (e: any) {
      throw new Error(`_handleCommandMessage: ${e.message}`);
    }
  };

  private _setRandomActivity = () => {
    const randomIndex = Math.floor(
      Math.random() * (this.activities.length - 1) + 1
    );
    this.client.user.setActivity(
      this.activities[randomIndex],
      { type: ActivityType.Playing }
    );
  };
};