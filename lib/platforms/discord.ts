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
  Message
} from 'discord.js';
import { BOT } from '../../util/constants';
import { format } from 'node:util';
import { Platform } from '.';
import config from '../../config';

//Branding
const primaryColor: ColorResolvable = 0xa02fe4;
const secondaryColor: ColorResolvable = 0xf0409b;

export type DiscordMessage = ChatInputCommandInteraction;

export declare interface Discord {
    on(event: 'Balance', callback: (
      platformId: string
    ) => void): this;
    on(event: 'Give', callback: (
      chatId: string,
      replyToMessageId: number,
      fromId: string,
      fromUsername: string,
      toId: string,
      toUsername: string,
      value: string
    ) => void): this;
    on(event: 'Deposit', callback: (
      platformId: string,
    ) => void): this;
    on(event: 'Withdraw', callback: (
      platformId: string,
      wAmount: number,
      wAddress: string,
    ) => void): this;
  }

export class Discord 
extends EventEmitter
implements Platform {
    private lastReplyTime: number;
    private discordToken: string;
    private clientId: string;
    private guildId: string;
    private client: Client;
    private rest: REST;
    private commands = [];
    constructor() {   
        super();
        this.lastReplyTime = Date.now();
        // Discord bot client and api setup
        this.clientId = config.discord.clientId;
        this.guildId = config.discord.guildId;
        this.client = new Client({
          intents: [GatewayIntentBits.Guilds,GatewayIntentBits.DirectMessages],
          partials: [Partials.Channel]
        });
      }
  /**
   * Instantiate the bot with API key. Also set up event handlers.
   * @param key - API key, as String
   */
  setup = async (apiKey: string) => {
    try{
        this.discordToken = apiKey;
        this.rest = new REST({ version: '10' }).setToken(this.discordToken);
        //Command JSON for Discord Command Registration Type 10 is number, 3 is string?
        this.commands = [
          {
            name: 'give',
            description: 'Give XPI to another user.',
            options:[
              {
                type:6,
                name:"to",
                description:"User to give XPI to",
                required:true
              },
              {
                type:10,
                name:"amount",
                description:"Amount of XPI to give.",
                required:true
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
            options:[
              {
                type:10,
                name:"amount",
                description:"Amount of XPI to withdraw.",
                required:true
              },
              {
                type:3,
                name:"address",
                description:"XPI Address for your external wallet.",
                required:true
              }
            ]
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
    }catch(err){
        throw new Error(`SETUP: ${err}`);
    }

  };
  /** Activate the bot */
  launch = async () => {
    await this._registerCommands();

    this.client.on('ready', () => {
        console.log(`Logged in as ${this.client.user.tag}!`);
        this.client.user.setActivity(
          "🪷 Give appreciation with Lotus 🪷",
          {type: ActivityType.Playing}
        );
        const activities = [
          "🪷 Give appreciation with Lotus 🪷",
          "🪷 givelotus.org 🪷",
          "🪷 Use /balance to start 🪷"
        ];
        setInterval(() => {
          // generate random number between 1 and list length.
          const randomIndex = Math.floor(Math.random() * (activities.length - 1) + 1);
          const newActivity = activities[randomIndex];
          this.client.user.setActivity(newActivity, {type: ActivityType.Playing});
        }, 10000);
        
    });
    // Handle Direct Messages and Commands from Server(s)
    this.client.on('messageCreate', this._handleDirectMessage);
    this.client.on('interactionCreate', this._handleCommandMessage);

    // Connect to Discord
    this.client.login(this.discordToken);
  };
  /** Deactivate the bot */
  stop = async () => {
    console.log("Bye daddy. uwu");
    await this.client.destroy();
  };
  getBotId = () => this.clientId;
  sendBalanceReply = async (
    platformId: string,
    balance: string,
    interaction: ChatInputCommandInteraction
  ) => {
    try{
      await interaction.reply({ content: format(BOT.MESSAGE.BALANCE, balance), ephemeral: true });
    } catch(err){
      console.log(err.message);
    }
  }
  sendDepositReply = async (platformId: string, address: string) => {
    try{
      const depositReplyEmbed = new EmbedBuilder()
        .setColor(primaryColor)
        .setTitle(`View address on the Explorer`)
        .setURL(`${config.wallet.explorerUrl}/address/${address}`)
        .setDescription('Send Lotus here to fund your account')
        .addFields(
          { name: 'Lotus Address', value: address }
        )
        .setImage(`${config.wallet.explorerUrl}/qr/${address}`)
        .setTimestamp();

      const userObj = await this.client.users.fetch(platformId);
      await userObj.send({embeds: [depositReplyEmbed]});
    }catch(err){
      console.log(err.message);
    }
  }
  sendDepositReceived = async (
    platformId: string,
    txid: string,
    amount: string
  ) => {
    try{
      const despositRecEmbed = new EmbedBuilder()
        .setColor(primaryColor)
        .setTitle('Deposit Received 🪷 - Click Here to see the tx.')
        .setURL(`${config.wallet.explorerUrl}/tx/${txid}`)
        .setDescription(`I received your deposit of ${amount} XPI. I will let you know when it confirms.`)
        .setTimestamp();

    const userObj = await this.client.users.fetch(platformId);
    await userObj.send({embeds: [despositRecEmbed]});
    }catch(err){
      console.log(err.message);
    }
  }
  sendDepositConfirmed = async (
    platformId: string,
    txid: string,
    amount: string,
    balance: string
  ) => {
    try{
      const despositRecEmbed = new EmbedBuilder()
        .setColor(secondaryColor)
        .setTitle('Deposit Confirmed 🪷 - Click Here to see the tx.')
        .setURL(`${config.wallet.explorerUrl}/tx/${txid}`)
        .setDescription(`Your deposit of ${amount} XPI has been confirmed! Your balance is now ${balance} XPI.`)
        .setTimestamp();

    const userObj = await this.client.users.fetch(platformId);
    await userObj.send({embeds: [despositRecEmbed]});
    }catch(err){
      console.log(err.message);
    }
  };
  sendGiveReply = async (
    chatId: string,
    replyToMessageId: number,
    fromUsername: string,
    toUsername: string,
    amount: string,
    interaction: ChatInputCommandInteraction
  ) => {
    try{
      await interaction.reply(
        format(BOT.MESSAGE.GIVE,
          "<@"+interaction.user.id+">",
          amount,
          "<@"+interaction.options.getUser('to').id+">"
        ));
    }catch(err){
      console.log(err.message);
    }
  }
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
    try{
      const userObj = await this.client.users.fetch(platformId);
      if(error){
        await userObj.send(`There was an error processing your withdrawal: ${error}`);
      } else {
        const despositRecEmbed = new EmbedBuilder()
          .setColor(primaryColor)
          .setTitle('Withdrawal Successful 🪷 - Click Here to see the tx.')
          .setURL(`${config.wallet.explorerUrl}/tx/${txid}`)
          .setDescription(`Your withdrawal of ${amount} XPI was successful!`)
          .setTimestamp();

        await userObj.send({embeds: [despositRecEmbed]});
      }
    }catch(err){
      console.log(err.message);
    }
  }
  private _registerCommands = async () => {
    try {
        console.log(`Started refreshing ${this.commands.length} application (/) commands.`);
        // The put method is used to fully refresh all commands in the guild with the current set
        await this.rest.put(
            Routes.applicationGuildCommands(this.clientId, this.guildId),
            { body: this.commands },
        );
        console.log(`Finshed refreshing ${this.commands.length} application (/) commands.`);
    } catch (err) {
        // And of course, make sure you catch and log any errors!
        throw new Error(`REGISTERCOMMANDS: ${err.message}`);
    }
  }
  private _handleDirectMessage = async (message: Message) => {
    const {
      author,
      content
    } = message;

    if(author.id == this.clientId) return;

    const dmCommand = content.trim().split(" ");
    switch(dmCommand[0]){
      case "balance":
        this.emit('Balance',author.id, message);
        break;
      case "deposit":
        this.emit('Deposit',author.id);
        break;
      case "withdraw":
        if(dmCommand.length < 3){
          await message.reply("You must use the following syntax for withdrawing:\r\n`withdraw <amount> <external_address>`");
          break;
        }
        if(parseInt(dmCommand[1]) <= 0){
          await message.reply("The value for withdrawal must be greater than 0.");
          break;
        }
        this.emit('Withdraw',author.id,dmCommand[1],dmCommand[2]);
        break;
      default:
        message.reply(`You can only use the following verbs in my DMs:
        
**balance** - Get your current balance in the bot.
**deposit** - Get the deposit information needed to send XPI to your bot wallet.
**Withdraw** - Withdraw XPI from your bot wallet to an external wallet address.

To use the Withdraw command, please use the following syntax:
\`withdraw <amount> <external_address>\`
        `);
        break;
    }
  }
  private _handleCommandMessage = async (interaction: ChatInputCommandInteraction) =>{
    if (!interaction.isChatInputCommand()) return;
    const {
      user,
      channelId,
      options,
      commandName
    } = interaction;
    const fromUser = user.username+"#"+user.discriminator;
    const platformId = user.id;
    console.log(`Command sent from ${fromUser} on channel ${this.guildId}:${channelId} = ${commandName}`);
    const xpiAmount = options.getNumber('amount') ?? 0;

    switch(commandName){
        case "give":
          //Process give shit.
          const to = options.getUser('to');
          const toId = to.id
          const toUsername = to.username+"#"+to.discriminator;
          if(xpiAmount <= 0){
            await interaction.reply({
              content: format(BOT.MESSAGE.ERR_AMOUNT_INVALID, xpiAmount),
              ephemeral: true
            });
            break;
          }
          if(this.clientId == to.id){
            await interaction.reply({
              content: format(BOT.MESSAGE.ERR_GIVE_TO_BOT),
              ephemeral: true
            });
            break;
          }
          this.emit('Give',
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
          this.emit('Balance', platformId, interaction);
          break;
        case "deposit":
          this.emit('Deposit',platformId);
          await interaction.reply({
            content: `Please check your DMs for reply message.`,
            ephemeral: true
          });
          break;
        case "withdraw":
          this.emit('Withdraw',
            platformId,
            xpiAmount.toString(),
            options.getString("address")
          );
          await interaction.reply({
            content: `Please check your DMs for reply message.`,
            ephemeral: true
          });
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
  }
}