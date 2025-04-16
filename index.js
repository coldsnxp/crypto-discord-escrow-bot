
require('dotenv').config();
const {
  Client, GatewayIntentBits, Events,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType, PermissionsBitField
} = require('discord.js');
const mongoose = require('mongoose');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

const ticketSchema = new mongoose.Schema({
  userId: String,
  crypto: String,
  channelId: String,
  secureToken: String,
  userToAddPending: { type: Boolean, default: true },
  invalidWarned: { type: Boolean, default: false },
  restrictedWarned: { type: Boolean, default: false },
  selfWarned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Ticket = mongoose.model("Ticket", ticketSchema);

const restrictedIds = (process.env.RESTRICTED_IDS || "").split(",").map(id => id.trim());

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const pendingTickets = await Ticket.find({ userToAddPending: true });
  for (const ticket of pendingTickets) {
    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!channel || !guild) continue;
    waitForUserId(channel, ticket.userId, guild, ticket._id, false);
  }
});

client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  if (message.content === "!deploy" && message.author.id === process.env.OWNER_ID) {
    const embed = new EmbedBuilder()
      .setTitle("Select a Cryptocurrency")
      .setDescription("Choose which crypto this ticket is for.")
      .setColor("#953CD3");

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`crypto_select_${Date.now()}`)
      .setPlaceholder("Choose one...")
      .addOptions(
        { label: "Bitcoin", value: "btc" },
        { label: "Ethereum", value: "eth" },
        { label: "Litecoin", value: "ltc" },
        { label: "Solana", value: "sol" },
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await message.channel.send({ embeds: [embed], components: [row] });
  }

  if (message.content === "!delete" && message.author.id === process.env.OWNER_ID) {
    try { await message.channel.delete(); } catch (err) { console.error(err); }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu() || !interaction.customId.startsWith("crypto_select")) return;

  const selected = interaction.values[0];
  const cryptoNames = {
    btc: "Bitcoin",
    eth: "Ethereum",
    ltc: "Litecoin",
    sol: "Solana"
  };
  const label = cryptoNames[selected] || selected.toUpperCase();
  const guild = interaction.guild;
  const secureToken = generateSecureToken();

  const ticketChannel = await guild.channels.create({
    name: `${selected}-ticket`,
    type: ChannelType.GuildText,
    parent: process.env.CATEGORY_ID,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [PermissionsBitField.Flags.ViewChannel],
      }
    ]
  });

  const ticketDoc = await Ticket.create({
    userId: interaction.user.id,
    crypto: selected,
    channelId: ticketChannel.id,
    secureToken: secureToken
  });

  const embed1 = new EmbedBuilder()
    .setTitle("Automated Middleman System")
     .setDescription(
  ` Welcome to our automated cryptocurrency middleman system! Your cryptocurrency will be securely held in escrow throughout the duration of this transaction.\n\n` +
  `> **Escrow Currency:**  \`${label}\`\n` +
  `> **Secure Token:**  \`${secureToken}\``
)
   // .setDescription(`Welcome to our automated cryptocurrency middleman system! Your cryptocurrency will be securely held in escrow throughout the duration of this transaction.\n\n > **Escrow Currency:** `)
   // :/.addFields(
   //   { name: '> Escrow Currency', value: `> \`${label}\``, inline: true },
 //     { name: '> Secure Token', value: `> \`${secureToken}\``, inline: true },
 //   )
    .setColor('#00b050')
    .setThumbnail('https://media.discordapp.net/attachments/1284169798699323478/1285225104342782023/atm_1.png?ex=66e97ea7&is=66e82d27&hm=81edd72763ea61d5abd0509f4d1e0229e3e30ee55f462d834527a76f17574a2f&=&format=webp&quality=lossless&width=958&height=958');

  const embed2 = new EmbedBuilder()
    .setTitle('Security Notification')
    .setDescription(`Keep all transaction-related communications within this ticket. Retain the secure token until your funds are in escrow.`)
    .setColor('#ff3c3c');

  const closeBtn = new ButtonBuilder()
    .setCustomId("close_ticket")
    .setLabel("Close 🔒")
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(closeBtn);

  await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed1, embed2], components: [row] });

  const ticketCreatedEmbed = new EmbedBuilder()
    .setTitle('Ticket Created')
    .setDescription(`Your ${label} ticket has been created at <#${ticketChannel.id}>`)
    .setColor('#953CD3');

  await interaction.reply({ embeds: [ticketCreatedEmbed], ephemeral: true });

  const refreshedSelect = new StringSelectMenuBuilder()
    .setCustomId(`crypto_select_${Date.now()}`)
    .setPlaceholder("Choose one...")
    .addOptions(
      { label: "Bitcoin", value: "btc" },
      { label: "Ethereum", value: "eth" },
      { label: "Litecoin", value: "ltc" },
      { label: "Solana", value: "sol" },
    );
  const refreshRow = new ActionRowBuilder().addComponents(refreshedSelect);
  await interaction.message.edit({ components: [refreshRow] });

  waitForUserId(ticketChannel, interaction.user.id, guild, ticketDoc._id, true);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton() || interaction.customId !== "close_ticket") return;

  await Ticket.deleteOne({ channelId: interaction.channel.id });
  const closingEmbed = new EmbedBuilder()
    .setTitle('Ticket Closed 🔒')
    .setDescription(`This ticket will be deleted in 5 seconds.`)
    .setColor('#ff3c3c');

  await interaction.reply({ embeds: [closingEmbed] });
  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
});

async function waitForUserId(channel, requesterId, guild, ticketId, sendInitialPrompt = false) {
  const askEmbed = new EmbedBuilder()
    .setTitle("👥 Add User to Ticket")
    .setDescription("Please provide the **Discord User ID** of the person you want to add.")
    .setColor("#953CD3");

  if (sendInitialPrompt) {
    await channel.send({ embeds: [askEmbed] });
  }

  const filter = m => m.author.id === requesterId;

  const collectUserId = async () => {
    const collector = channel.createMessageCollector({ filter, max: 1 });

    collector.on('collect', async msg => {
      const userId = msg.content.trim();
      const ticket = await Ticket.findById(ticketId);

      if (userId === requesterId) {
        if (!ticket.selfWarned) {
          await channel.send({ embeds: [new EmbedBuilder()
            .setDescription(" You cannot trade with yourself.")
            .setColor("#ffcc00")] });
          await Ticket.findByIdAndUpdate(ticketId, { selfWarned: true });
        }
        collectUserId();
        return;
      }

      if (restrictedIds.includes(userId)) {
        if (!ticket.restrictedWarned) {
          await channel.send({ embeds: [new EmbedBuilder()
            .setDescription("You cannot trade with this user.")
            .setColor("#ff0000")] });
          await Ticket.findByIdAndUpdate(ticketId, { restrictedWarned: true });
        }
        collectUserId();
        return;
      }

      try {
        const memberToAdd = await guild.members.fetch(userId);

        await channel.permissionOverwrites.edit(memberToAdd.id, {
          ViewChannel: true,
          SendMessages: true
        });

        const recentMessages = await channel.messages.fetch({ limit: 25 });
        const warnings = recentMessages.filter(m =>
          m.embeds?.[0]?.title === "Invalid User ID" ||
          m.embeds?.[0]?.title === "👥 Add User to Ticket" ||
          m.embeds?.[0]?.description === "You cannot trade with yourself." ||
          m.embeds?.[0]?.description === "You cannot trade with this user."
        );
        for (const msg of warnings.values()) {
          await msg.delete().catch(() => {});
        }

        const successEmbed = new EmbedBuilder()
          .setDescription(`Added <@${memberToAdd.id}> to this ticket.`)
          .setColor("#00b050");

        await channel.send({ content: `<@${memberToAdd.id}>`, embeds: [successEmbed] });

        await Ticket.findByIdAndUpdate(ticketId, { userToAddPending: false });
      } catch {
        if (!ticket.invalidWarned) {
          await channel.send({ embeds: [new EmbedBuilder()
            .setTitle("Invalid User ID")
            .setDescription("That wasn't a valid user. Please try again.")
            .setColor("#ff0000")] });
          await Ticket.findByIdAndUpdate(ticketId, { invalidWarned: true });
        }
        collectUserId();
      }
    });
  };

  collectUserId();
}


function generateSecureToken(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

client.login(process.env.TOKEN);
