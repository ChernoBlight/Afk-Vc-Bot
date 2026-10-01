require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const afkData = new Map();

// ====================== COMMANDS ======================
const commands = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your current voice channel and AFK'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel'),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check the bot\'s latency'),
].map(c => c.toJSON());

// ====================== READY ======================
client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

// Prevent crashes
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ====================== JOIN FUNCTION ======================
async function joinChannel(channel) {
  const existing = getVoiceConnection(channel.guild.id);
  if (existing) existing.destroy();

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
      debug: false,
  });

  afkData.set(channel.guild.id, channel.id);

  connection.on('debug', (message) => {
    console.log(`[VOICE DEBUG] ${message}`);
  });

  connection.on('error', (error) => {
    console.error(`[${channel.guild.name}] Connection error:`, error.message);
  });

  connection.on('stateChange', (oldState, newState) => {
    console.log(`[${channel.guild.name}] ${oldState.status} → ${newState.status}`);
  });

  // Auto-rejoin
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    if (!afkData.has(channel.guild.id)) return;

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      return;
    } catch {}

    console.log(`[${channel.guild.name}] Disconnected → rejoining in 3s...`);
    await new Promise(r => setTimeout(r, 3000));

    try {
      const targetId = afkData.get(channel.guild.id);
      const target = await channel.guild.channels.fetch(targetId).catch(() => null);
      if (!target?.isVoiceBased()) {
        afkData.delete(channel.guild.id);
        connection.destroy();
        return;
      }
      connection.destroy();
      await joinChannel(target);
    } catch (err) {
      console.error(`[${channel.guild.name}] Rejoin failed:`, err.message);
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    console.log(`[${channel.guild.name}] ✅ Fully Ready in ${channel.name}`);
  } catch {
    console.log(`[${channel.guild.name}] ⚠️ Did not reach Ready in time`);
  }

  return connection;
}

// ====================== INTERACTIONS ======================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // JOIN
    if (interaction.commandName === 'join') {
      await interaction.deferReply().catch(() => null);

      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) return interaction.editReply('You need to be in a voice channel first!');
      if (getVoiceConnection(interaction.guildId)) return interaction.editReply('I am already connected!');

      try {
        await joinChannel(voiceChannel);
        await interaction.editReply(`Joined **${voiceChannel.name}** and going AFK 💤`);
      } catch (err) {
        console.error(err);
        await interaction.editReply('Failed to join the voice channel.');
      }
    }

    // LEAVE
    if (interaction.commandName === 'leave') {
      const connection = getVoiceConnection(interaction.guildId);
      if (!connection) return interaction.reply({ content: 'I am not in a voice channel!', ephemeral: true });

      afkData.delete(interaction.guildId);
      connection.destroy();
      await interaction.reply('Left the voice channel.');
    }

    // PING
    if (interaction.commandName === 'ping') {
      await interaction.reply('Pinging...');
      const reply = await interaction.fetchReply();
      const latency = reply.createdTimestamp - interaction.createdTimestamp;
      const apiLatency = Math.round(client.ws.ping);

      await interaction.editReply(
        `Pong! 🏓\nBot Latency: **${latency}ms**\nAPI Latency: **${apiLatency}ms**`
      );
    }
  } catch (err) {
    console.error('Interaction error:', err);
  }
});

// ====================== LOGIN ======================
client.login(process.env.TOKEN);