require('dotenv').config();
const express = require('express');
const cors = require('cors');
const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;
const DISCORD_INTEGRATION_ENABLED = process.env.DISCORD_INTEGRATION_ENABLED === 'true';

// Enable CORS for all origins (or configure specific origins as needed)
app.use(cors());
// Middleware to parse JSON request bodies
app.use(express.json());

// Rate limit middleware (10 requests per minute per IP)
const rateLimits = {};
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  if (!rateLimits[ip]) {
    rateLimits[ip] = { count: 1, timestamp: now };
    return next();
  }
  if (now - rateLimits[ip].timestamp < 60000) { // 1 minute window
    if (rateLimits[ip].count >= 10) {
      return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    }
    rateLimits[ip].count++;
  } else {
    rateLimits[ip] = { count: 1, timestamp: now };
  }
  next();
});

// -------------------- Single Discord Client Instance -------------------- //

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel] // For DM channels not yet cached
});

// ----------------------- Express Routes ----------------------- //

app.get('/', (req, res) => {
  res.send('Discord Moderator & Giveaway Bot API - Use POST /notify for moderator notifications, and /host-giveaway for giveaways.');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    discordConnected: client.isReady()
  });
});

/**
 * POST /notify
 * Receives notifications from the moderator application service.
 * Expected JSON payload:
 * {
 *   "discordId": "123456789012345678",   // Discord user ID (17-19 digits)
 *   "status": "submitted" | "approved" | "rejected",
 *   "payload": { ... }                   // (Optional) Additional details (e.g., rejection reason)
 * }
 */
app.post('/notify', async (req, res) => {
  if (!DISCORD_INTEGRATION_ENABLED) {
    return res.status(503).json({ error: "Discord integration is currently disabled." });
  }

  const { discordId, status, payload = {} } = req.body;
  if (!discordId || !status) {
    return res.status(400).json({ error: "Missing discordId or status in request body." });
  }

  // Validate discordId format (17-19 digits)
  const discordIdRegex = /^\d{17,19}$/;
  if (!discordIdRegex.test(discordId)) {
    return res.status(400).json({ error: "Invalid Discord ID format." });
  }

  if (!client.isReady()) {
    return res.status(503).json({ error: "Discord bot is not connected." });
  }

  const validStatuses = ["submitted", "approved", "rejected"];
  if (!validStatuses.includes(status.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid status provided. Must be one of: ${validStatuses.join(', ')}.`
    });
  }

  let message = "";
  switch (status.toLowerCase()) {
    case "submitted":
      message = `Your moderator application has been **submitted** and is up for review.`;
      break;
    case "approved":
      message = `🎉 Congratulations! Your moderator application has been **approved**. You will now move on to the interview and will be contacted within **4-5 days**.`;
      break;
    case "rejected":
      message = `We regret to inform you that your moderator application didn't meet the requirements and has been **rejected**.`;
      break;
  }
  if (payload.details) {
    message += `\n\n**Details:** ${payload.details}`;
  }
  try {
    let user;
    try {
      user = await client.users.fetch(discordId);
    } catch (fetchError) {
      return res.status(404).json({ error: "Discord user not found or bot cannot access this user." });
    }
    await user.send(message);
    console.log(`Notification sent to ${user.tag} (${discordId}) - Status: ${status}`);
    return res.status(200).json({
      success: true,
      message: "Notification sent successfully.",
      recipient: user.tag
    });
  } catch (error) {
    console.error("Error sending notification:", error);
    return res.status(500).json({
      error: "Failed to send notification",
      details: error.message
    });
  }
});

// ------------------- Giveaway Hosting Integration -------------------- //

// In-memory storage for pending giveaway applications, keyed by applicant ID.
const pendingGiveaways = new Map();

// Register the /host-giveaway command on a specific guild when the bot is ready
client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);

  // Replace with your actual Guild ID
  const guildId = '1342353336229433344';
  const guild = client.guilds.cache.get(guildId);
  if (guild) {
    try {
      await guild.commands.create(
        new SlashCommandBuilder()
          .setName('host-giveaway')
          .setDescription('Host a new giveaway using a detailed submission form')
          .toJSON()
      );
      console.log('/host-giveaway command registered.');
    } catch (error) {
      console.error('Error registering command:', error);
    }
  } else {
    console.warn('Guild not found. Slash command not registered.');
  }
  // Start the Express HTTP server only after the bot is ready.
  app.listen(port, () => {
    console.log(`HTTP server is running on port ${port}`);
  });
});

// Listen for Discord interactions (slash commands, modals, buttons)
client.on('interactionCreate', async (interaction) => {
  // Handle /host-giveaway slash command
  if (interaction.isChatInputCommand() && interaction.commandName === 'host-giveaway') {
    const modal = new ModalBuilder() 
      .setCustomId('giveawayModal')
      .setTitle('Host Giveaway Application');

    const titleInput = new TextInputBuilder()
      .setCustomId('giveawayTitle')
      .setLabel('Giveaway Title')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const descriptionInput = new TextInputBuilder()
      .setCustomId('giveawayDescription')
      .setLabel('Description / Contents')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    const durationInput = new TextInputBuilder()
      .setCustomId('giveawayDuration')
      .setLabel('Duration (e.g., 1h, 30m)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const conditionsInput = new TextInputBuilder()
      .setCustomId('giveawayConditions')
      .setLabel('Entry Conditions (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(descriptionInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(conditionsInput)
    );

    await interaction.showModal(modal);
  }
  // Handle modal submission for giveaway details
  else if (interaction.isModalSubmit() && interaction.customId === 'giveawayModal') {
    const title = interaction.fields.getTextInputValue('giveawayTitle');
    const description = interaction.fields.getTextInputValue('giveawayDescription');
    const duration = interaction.fields.getTextInputValue('giveawayDuration');
    const conditions = interaction.fields.getTextInputValue('giveawayConditions');

    pendingGiveaways.set(interaction.user.id, {
      title,
      description,
      duration,
      conditions,
      applicantId: interaction.user.id,
      applicantTag: interaction.user.tag
    });

    const confirmButton = new ButtonBuilder()
      .setCustomId('agreeSubmission')
      .setLabel('I Agree')
      .setStyle(ButtonStyle.Primary);
    const actionRow = new ActionRowBuilder().addComponents(confirmButton);

    await interaction.reply({
      content: 'Your giveaway application details have been submitted for review. Please click **I Agree** to confirm and forward your application to the moderators.',
      components: [actionRow],
      ephemeral: true
    });
  }
  // Handle button interactions
  else if (interaction.isButton()) {
    // Applicant clicks "I Agree" to submit giveaway application
    if (interaction.customId === 'agreeSubmission') {
      const giveawayData = pendingGiveaways.get(interaction.user.id);
      if (!giveawayData) {
        return interaction.reply({ content: 'No pending giveaway application found.', ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle('New Giveaway Application')
        .setDescription('A new giveaway application has been submitted and awaits review.')
        .addFields(
          { name: 'Title', value: giveawayData.title, inline: true },
          { name: 'Description / Contents', value: giveawayData.description, inline: false },
          { name: 'Duration', value: giveawayData.duration, inline: true },
          { name: 'Conditions', value: giveawayData.conditions || 'None', inline: true },
          { name: 'Applicant', value: `<@${giveawayData.applicantId}> (${giveawayData.applicantTag})`, inline: false }
        )
        .setTimestamp();

      const approveButton = new ButtonBuilder()
        .setCustomId(`approve_${giveawayData.applicantId}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success);
      const denyButton = new ButtonBuilder()
        .setCustomId(`deny_${giveawayData.applicantId}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger);
      const contactButton = new ButtonBuilder()
        .setCustomId(`contact_${giveawayData.applicantId}`)
        .setLabel('Contact User')
        .setStyle(ButtonStyle.Primary);
      const modActionRow = new ActionRowBuilder().addComponents(approveButton, denyButton, contactButton);

      // Replace with your actual moderator channel ID
      const modChannelId = '1357863365116039308';
      const modChannel = await client.channels.fetch(modChannelId);
      await modChannel.send({ embeds: [embed], components: [modActionRow] });

      pendingGiveaways.delete(interaction.user.id);
      await interaction.update({ content: 'Your giveaway application has been forwarded to the moderators for review.', components: [] });
    }
    // Moderator Approves
    else if (interaction.customId.startsWith('approve_')) {
      const applicantId = interaction.customId.split('_')[1];
      try {
        const user = await client.users.fetch(applicantId);
        // Send DM to user with approval notice plus a "Host" button
        const hostButton = new ButtonBuilder()
          .setCustomId(`hostGiveaway_${applicantId}`)
          .setLabel('Host')
          .setStyle(ButtonStyle.Primary);
        const hostActionRow = new ActionRowBuilder().addComponents(hostButton);
        await user.send({
          content: 'Your giveaway application has been **approved**! Click the button below to start customizing your giveaway.',
          components: [hostActionRow]
        });
      } catch (error) {
        console.error('Error sending approval DM:', error);
      }
      // Update the original moderator message to indicate approval and remove other buttons
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription('This giveaway application has been **approved**.')
        .setFooter({ text: 'Approved' })
        .setColor('Green');
      await interaction.update({
        embeds: [updatedEmbed],
        components: [] // Remove buttons so they cannot be clicked again
      });
      await interaction.followUp({ content: 'Application approved.', ephemeral: true });
    }
    // Moderator Denies
    else if (interaction.customId.startsWith('deny_')) {
      const applicantId = interaction.customId.split('_')[1];
      try {
        const user = await client.users.fetch(applicantId);
        await user.send('Your giveaway application has been **denied**. Please contact the moderators for more information.');
      } catch (error) {
        console.error('Error sending denial DM:', error);
      }
      // Update the original moderator message to indicate denial and remove other buttons
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription('This giveaway application has been **denied**.')
        .setFooter({ text: 'Rejected' })
        .setColor('Red');
      await interaction.update({
        embeds: [updatedEmbed],
        components: [] // Remove buttons
      });
      await interaction.followUp({ content: 'Application denied.', ephemeral: true });
    }
    // Moderator "Contact User" handling: Create a private channel for direct communication.
    else if (interaction.customId.startsWith('contact_')) {
      const applicantId = interaction.customId.split('_')[1];
      const guild = client.guilds.cache.get('1342353336229433344'); // Replace with your Guild ID
      if (!guild) return interaction.reply({ content: 'Guild not found.', ephemeral: true });
      try {
        const channel = await guild.channels.create({
          name: `contact-${applicantId.slice(-4)}-${Date.now()}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: applicantId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
          ]
        });
        await channel.send({ content: `Hello <@${applicantId}> and <@${interaction.user.id}>, this is your private channel for further discussion regarding your giveaway application.` });
        await interaction.reply({ content: 'A private contact channel has been created.', ephemeral: true });
      } catch (error) {
        console.error('Error creating contact channel:', error);
        await interaction.reply({ content: 'Failed to create a private contact channel.', ephemeral: true });
      }
    }
    // Handle the "Host" button click from approved applicants.
    else if (interaction.customId.startsWith('hostGiveaway_')) {
      // Placeholder: Replace this with your detailed giveaway builder logic.
      await interaction.reply({ content: 'Slight error, please try again', ephemeral: true });
    }
  }
});

// ---------------------- End Giveaway Integration ---------------------- //

// Global error handler for Discord client
client.on('error', error => {
  console.error('Discord client error:', error);
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await client.destroy();
  process.exit(0);
});

// Log in to Discord with your bot token
client.login(process.env.BOT_TOKEN).catch(error => {
  console.error('Failed to connect to Discord:', error);
  process.exit(1);
});

//// ------------------- Giveaway Builder - Multi-Step Wizard (Updated) -------------------- //
//
//// In-memory storage for active giveaway builder sessions, keyed by user ID.
//const giveawayBuilders = new Map();
//
//client.on('interactionCreate', async (interaction) => {
//  // ------------------ Step 0: Starting the Builder ------------------
//  // Handle the "Host" button from an approved applicant's DM.
//  if (interaction.isButton() && interaction.customId.startsWith('hostGiveaway_')) {
//    // Initialize a builder session for this user.
//    giveawayBuilders.set(interaction.user.id, { step: 1, data: {} });
//    
//    // Step 1: Basic Information Modal (channel selection removed)
//    const basicModal = new ModalBuilder()
//      .setCustomId('basicInfoModal')
//      .setTitle('Giveaway Builder - Basic Information');
//    
//    const titleInput = new TextInputBuilder()
//      .setCustomId('giveawayTitle')
//      .setLabel('Giveaway Title')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(true);
//    const prizeInput = new TextInputBuilder()
//      .setCustomId('prizeDescription')
//      .setLabel('Prize Description')
//      .setStyle(TextInputStyle.Paragraph)
//      .setRequired(true);
//    const winnersInput = new TextInputBuilder()
//      .setCustomId('numberWinners')
//      .setLabel('Number of Winners (1-20)')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(true);
//    const durationInput = new TextInputBuilder()
//      .setCustomId('giveawayDuration')
//      .setLabel('Duration (e.g., 1h, 2d, 1w)')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(true);
//    
//    basicModal.addComponents(
//      new ActionRowBuilder().addComponents(titleInput),
//      new ActionRowBuilder().addComponents(prizeInput),
//      new ActionRowBuilder().addComponents(winnersInput),
//      new ActionRowBuilder().addComponents(durationInput)
//    );
//    await interaction.showModal(basicModal);
//  }
//  // ------------------ Step 1: Basic Information Modal Submission ------------------
//  else if (interaction.isModalSubmit() && interaction.customId === 'basicInfoModal') {
//    const builderSession = giveawayBuilders.get(interaction.user.id);
//    if (!builderSession) return interaction.reply({ content: "No builder session found.", ephemeral: true });
//    
//    // Save basic info in session data
//    builderSession.data.title = interaction.fields.getTextInputValue('giveawayTitle');
//    builderSession.data.prize = interaction.fields.getTextInputValue('prizeDescription');
//    builderSession.data.winners = interaction.fields.getTextInputValue('numberWinners');
//    builderSession.data.duration = interaction.fields.getTextInputValue('giveawayDuration');
//    builderSession.step = 2;
//    giveawayBuilders.set(interaction.user.id, builderSession);
//    
//    // Send a preview and prompt to continue to Entry Requirements
//    const previewEmbed = new EmbedBuilder()
//      .setTitle('Giveaway Preview - Basic Information')
//      .addFields(
//        { name: 'Title', value: builderSession.data.title, inline: true },
//        { name: 'Prize', value: builderSession.data.prize, inline: true },
//        { name: 'Winners', value: builderSession.data.winners, inline: true },
//        { name: 'Duration', value: builderSession.data.duration, inline: true }
//      )
//      .setColor('Blue')
//      .setTimestamp();
//    
//    const nextButton = new ButtonBuilder()
//      .setCustomId('toEntryRequirements')
//      .setLabel('Next: Entry Requirements')
//      .setStyle(ButtonStyle.Primary);
//    const nextRow = new ActionRowBuilder().addComponents(nextButton);
//    
//    await interaction.reply({
//      content: 'Basic Information saved. See preview below:',
//      embeds: [previewEmbed],
//      components: [nextRow],
//      ephemeral: true
//    });
//  }
//  // ------------------ Step 2: Entry Requirements Modal ------------------
//  else if (interaction.isButton() && interaction.customId === 'toEntryRequirements') {
//    const entryModal = new ModalBuilder()
//      .setCustomId('entryRequirementsModal')
//      .setTitle('Giveaway Builder - Entry Requirements');
//    
//    const membershipInput = new TextInputBuilder()
//      .setCustomId('membershipDuration')
//      .setLabel('Server Membership Duration (e.g., 7d)')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(true);
//    const messageCountInput = new TextInputBuilder()
//      .setCustomId('minMessageCount')
//      .setLabel('Minimum Message Count')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(true);
//    const rolesInput = new TextInputBuilder()
//      .setCustomId('requiredRoles')
//      .setLabel('Required Roles (comma separated IDs)')
//      .setStyle(TextInputStyle.Paragraph)
//      .setRequired(false);
//    const customEntryInput = new TextInputBuilder()
//      .setCustomId('customEntry')
//      .setLabel('Custom Entry Requirements')
//      .setStyle(TextInputStyle.Paragraph)
//      .setRequired(false);
//    
//    entryModal.addComponents(
//      new ActionRowBuilder().addComponents(membershipInput),
//      new ActionRowBuilder().addComponents(messageCountInput),
//      new ActionRowBuilder().addComponents(rolesInput),
//      new ActionRowBuilder().addComponents(customEntryInput)
//    );
//    await interaction.showModal(entryModal);
//  }
//  // ------------------ Step 2 Submission: Entry Requirements ------------------
//  else if (interaction.isModalSubmit() && interaction.customId === 'entryRequirementsModal') {
//    const builderSession = giveawayBuilders.get(interaction.user.id);
//    if (!builderSession) return interaction.reply({ content: "No builder session found.", ephemeral: true });
//    
//    builderSession.data.membership = interaction.fields.getTextInputValue('membershipDuration');
//    builderSession.data.minMessages = interaction.fields.getTextInputValue('minMessageCount');
//    builderSession.data.requiredRoles = interaction.fields.getTextInputValue('requiredRoles');
//    builderSession.data.customEntry = interaction.fields.getTextInputValue('customEntry');
//    builderSession.step = 3;
//    giveawayBuilders.set(interaction.user.id, builderSession);
//    
//    const previewEmbed = new EmbedBuilder()
//      .setTitle('Giveaway Preview - Entry Requirements')
//      .addFields(
//        { name: 'Membership Duration', value: builderSession.data.membership, inline: true },
//        { name: 'Minimum Messages', value: builderSession.data.minMessages, inline: true },
//        { name: 'Required Roles', value: builderSession.data.requiredRoles || 'None', inline: true },
//        { name: 'Custom Entry', value: builderSession.data.customEntry || 'None', inline: false }
//      )
//      .setColor('Blue')
//      .setTimestamp();
//    
//    const nextButton = new ButtonBuilder()
//      .setCustomId('toCustomization')
//      .setLabel('Next: Customization Options')
//      .setStyle(ButtonStyle.Primary);
//    const nextRow = new ActionRowBuilder().addComponents(nextButton);
//    
//    await interaction.reply({
//      content: 'Entry Requirements saved. See preview below:',
//      embeds: [previewEmbed],
//      components: [nextRow],
//      ephemeral: true
//    });
//  }
//  // ------------------ Step 3: Customization Options (Visual) ------------------
//  else if (interaction.isButton() && interaction.customId === 'toCustomization') {
//    // Instead of one modal with too many fields, show a modal for visual customization options.
//    const customVisualModal = new ModalBuilder()
//      .setCustomId('customVisualModal')
//      .setTitle('Giveaway Builder - Custom Visual Options');
//  
//    const colorInput = new TextInputBuilder()
//      .setCustomId('embedColor')
//      .setLabel('Custom Embed Color (hex code)')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(true);
//    const thumbnailInput = new TextInputBuilder()
//      .setCustomId('thumbnailUrl')
//      .setLabel('Thumbnail Image URL')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(false);
//    const bannerInput = new TextInputBuilder()
//      .setCustomId('bannerUrl')
//      .setLabel('Banner Image URL')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(false);
//    const buttonTextInput = new TextInputBuilder()
//      .setCustomId('buttonText')
//      .setLabel('Custom Button Text')
//      .setStyle(TextInputStyle.Short)
//      .setRequired(false);
//  
//    customVisualModal.addComponents(
//      new ActionRowBuilder().addComponents(colorInput),
//      new ActionRowBuilder().addComponents(thumbnailInput),
//      new ActionRowBuilder().addComponents(bannerInput),
//      new ActionRowBuilder().addComponents(buttonTextInput)
//    );
//    await interaction.showModal(customVisualModal);
//  }
//  // ------------------ Step 3 Submission: Custom Visual Options ------------------
//  else if (interaction.isModalSubmit() && interaction.customId === 'customVisualModal') {
//    const builderSession = giveawayBuilders.get(interaction.user.id);
//    if (!builderSession)
//      return interaction.reply({ content: "No builder session found.", ephemeral: true });
//  
//    builderSession.data.embedColor = interaction.fields.getTextInputValue('embedColor');
//    builderSession.data.thumbnailUrl = interaction.fields.getTextInputValue('thumbnailUrl');
//    builderSession.data.bannerUrl = interaction.fields.getTextInputValue('bannerUrl');
//    builderSession.data.buttonText = interaction.fields.getTextInputValue('buttonText');
//    giveawayBuilders.set(interaction.user.id, builderSession);
//  
//    // Instead of directly calling another modal from a modal submit, send an ephemeral message with a "Continue" button.
//    const continueButton = new ButtonBuilder()
//      .setCustomId('continueCustomMsgModal')
//      .setLabel('Continue to Custom Messages')
//      .setStyle(ButtonStyle.Primary);
//    const continueRow = new ActionRowBuilder().addComponents(continueButton);
//  
//    await interaction.reply({
//      content: 'Visual customization saved. Click the button below to continue to custom messages.',
//      components: [continueRow],
//      ephemeral: true
//    });
//  }
//  // ------------------ Step 4: Custom Messages Modal (Triggered via Button) ------------------
//  else if (interaction.isButton() && interaction.customId === 'continueCustomMsgModal') {
//    const customMsgModal = new ModalBuilder()
//      .setCustomId('customMsgModal')
//      .setTitle('Giveaway Builder - Custom Messages');
//  
//    const startMessageInput = new TextInputBuilder()
//      .setCustomId('startMessage')
//      .setLabel('Start Announcement Message')
//      .setStyle(TextInputStyle.Paragraph)
//      .setRequired(false);
//    const winnerMessageInput = new TextInputBuilder()
//      .setCustomId('winnerMessage')
//      .setLabel('Winner Announcement Message')
//      .setStyle(TextInputStyle.Paragraph)
//      .setRequired(false);
//    const entryConfirmInput = new TextInputBuilder()
//      .setCustomId('entryConfirmation')
//      .setLabel('Entry Confirmation Message')
//      .setStyle(TextInputStyle.Paragraph)
//      .setRequired(false);
//  
//    customMsgModal.addComponents(
//      new ActionRowBuilder().addComponents(startMessageInput),
//      new ActionRowBuilder().addComponents(winnerMessageInput),
//      new ActionRowBuilder().addComponents(entryConfirmInput)
//    );
//    await interaction.showModal(customMsgModal);
//  }
//  // ------------------ Step 4 Submission: Custom Messages ------------------
//  else if (interaction.isModalSubmit() && interaction.customId === 'customMsgModal') {
//    const builderSession = giveawayBuilders.get(interaction.user.id);
//    if (!builderSession)
//      return interaction.reply({ content: "No builder session found.", ephemeral: true });
//  
//    builderSession.data.startMessage = interaction.fields.getTextInputValue('startMessage');
//    builderSession.data.winnerMessage = interaction.fields.getTextInputValue('winnerMessage');
//    builderSession.data.entryConfirmation = interaction.fields.getTextInputValue('entryConfirmation');
//    builderSession.step = 5;
//    giveawayBuilders.set(interaction.user.id, builderSession);
//  
//    // Final preview with all details
//    const previewEmbed = new EmbedBuilder()
//      .setTitle('Giveaway Preview - Complete')
//      .setColor(builderSession.data.embedColor || 'Blue')
//      .setThumbnail(builderSession.data.thumbnailUrl || null)
//      .setImage(builderSession.data.bannerUrl || null)
//      .addFields(
//        // Basic Information:
//        { name: 'Title', value: builderSession.data.title || 'N/A', inline: true },
//        { name: 'Prize', value: builderSession.data.prize || 'N/A', inline: true },
//        { name: 'Winners', value: builderSession.data.winners || 'N/A', inline: true },
//        { name: 'Duration', value: builderSession.data.duration || 'N/A', inline: true },
//        // Entry Requirements:
//        { name: 'Membership Duration', value: builderSession.data.membership || 'N/A', inline: true },
//        { name: 'Minimum Messages', value: builderSession.data.minMessages || 'N/A', inline: true },
//        { name: 'Required Roles', value: builderSession.data.requiredRoles || 'None', inline: true },
//        { name: 'Custom Entry', value: builderSession.data.customEntry || 'None', inline: false },
//        // Custom Messages:
//        { name: 'Start Announcement', value: builderSession.data.startMessage || 'Default', inline: false },
//        { name: 'Winner Announcement', value: builderSession.data.winnerMessage || 'Default', inline: false },
//        { name: 'Entry Confirmation', value: builderSession.data.entryConfirmation || 'Default', inline: false }
//      )
//      .setTimestamp();
//  
//    const submitButton = new ButtonBuilder()
//      .setCustomId('submitGiveaway')
//      .setLabel('Submit Giveaway')
//      .setStyle(ButtonStyle.Success);
//    const submitRow = new ActionRowBuilder().addComponents(submitButton);
//  
//    await interaction.reply({
//      content: 'Customization saved. See full preview below. Click **Submit Giveaway** to finish.',
//      embeds: [previewEmbed],
//      components: [submitRow],
//      ephemeral: true
//    });
//  }
//  // ------------------ Final Step: Posting the Giveaway and Assigning the Host Role ------------------
//  else if (interaction.isButton() && interaction.customId === 'submitGiveaway') {
//    const builderSession = giveawayBuilders.get(interaction.user.id);
//    if (!builderSession)
//      return interaction.reply({ content: "No builder session found.", ephemeral: true });
//  
//    // Fixed giveaway channel ID
//    const giveawayChannelId = '1357678210334199858';
//    const giveawayChannel = await client.channels.fetch(giveawayChannelId);
//    if (!giveawayChannel)
//      return interaction.reply({ content: "Giveaway channel not found.", ephemeral: true });
//  
//    // Create the giveaway embed that will be posted publicly
//    const giveawayEmbed = new EmbedBuilder()
//      .setTitle(`🎉 ${builderSession.data.title} 🎉`)
//      .setDescription(`**Prize:** ${builderSession.data.prize}\n\nReact with 🎉 below to enter the giveaway!`)
//      .setColor(builderSession.data.embedColor || '#00BFFF') // Use provided color or default ocean blue
//      .setThumbnail(builderSession.data.thumbnailUrl || null)
//      .setImage(builderSession.data.bannerUrl || null)
//      .addFields(
//        { name: 'Number of Winners', value: `${builderSession.data.winners}`, inline: true },
//        { name: 'Duration', value: builderSession.data.duration, inline: true },
//        { name: 'Membership Requirement', value: builderSession.data.membership || 'None', inline: true },
//        { name: 'Min. Message Count', value: builderSession.data.minMessages || 'None', inline: true },
//        { name: 'Required Roles', value: builderSession.data.requiredRoles || 'None', inline: true },
//        { name: 'Additional Entry Requirements', value: builderSession.data.customEntry || 'None', inline: false },
//        { name: 'Start Announcement', value: builderSession.data.startMessage || 'N/A', inline: false },
//        { name: 'Winner Announcement', value: builderSession.data.winnerMessage || 'N/A', inline: false },
//        { name: 'Entry Confirmation', value: builderSession.data.entryConfirmation || 'N/A', inline: false }
//      )
//      .setTimestamp();
//    
//    // Create a header that shows "Hosted by" with the host's tag and profile picture
//    const hostUser = interaction.user;
//    giveawayEmbed.setFooter({
//      text: `Hosted by ${hostUser.tag}`,
//      iconURL: hostUser.displayAvatarURL({ dynamic: true })
//    });
//  
//    // Post the giveaway embed in the giveaway channel
//    await giveawayChannel.send({ embeds: [giveawayEmbed] });
//  
//    // Assign the "Giveaway Host" role to the user (Role ID: "1359265880382374041")
//    const guild = client.guilds.cache.get('1342353336229433344'); // Replace with your Guild ID
//    if (guild) {
//      try {
//        const member = await guild.members.fetch(hostUser.id);
//        await member.roles.add('1359265880382374041');
//      } catch (error) {
//        console.error('Error assigning Giveaway Host role:', error);
//      }
//    }
//    
//    // (Optional) Insert the giveaway data into Supabase or your chosen database here.
//    // Example: supabase.from('giveaways').insert(builderSession.data)
//  
//    await interaction.reply({ content: 'Your giveaway has been successfully created and posted!', ephemeral: true });
//    giveawayBuilders.delete(interaction.user.id);
//  }
//});
// ---------------------- End Giveaway Builder ---------------------- //