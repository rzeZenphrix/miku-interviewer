// index.js
require('dotenv').config(); // Optional: loads variables from a .env file
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;
const DISCORD_INTEGRATION_ENABLED = process.env.DISCORD_INTEGRATION_ENABLED === 'true';

// Create a new Discord client with necessary intents
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: ['CHANNEL'] // Needed for DM channels that are not cached
});

// Middleware to parse JSON request bodies
app.use(express.json());

/**
 * POST /notify
 * This endpoint receives notifications from your moderator application service.
 * Expected JSON payload:
 * {
 *   "discordId": "123456789012345678",   // Discord user ID (17-19 digits)
 *   "status": "submitted" | "approved" | "rejected",
 *   "payload": { ... }                   // (Optional) Additional details (e.g., rejection reason)
 * }
 */
app.post('/notify', async (req, res) => {
  // Check if Discord integration is enabled
  if (!DISCORD_INTEGRATION_ENABLED) {
    return res.status(503).json({ error: "Discord integration is currently disabled." });
  }

  const { discordId, status, payload } = req.body;

  // Validate required fields
  if (!discordId || !status) {
    return res.status(400).json({ error: "Missing discordId or status in request body." });
  }

  // Validate discordId format (must be 17-19 digits)
  const discordIdRegex = /^\d{17,19}$/;
  if (!discordIdRegex.test(discordId)) {
    return res.status(400).json({ error: "Invalid Discord ID format." });
  }

  // Build the message based on the status provided
  let message = "";
  switch (status.toLowerCase()) {
    case "submitted":
      message = `Your moderator application has been **submitted**. We have received your application and will review it soon.`;
      break;
    case "approved":
      message = `Congratulations! Your moderator application has been **approved**. Welcome to the team! Please check your dashboard for further instructions.`;
      break;
    case "rejected":
      message = `We regret to inform you that your moderator application has been **rejected**.`;
      break;
    default:
      return res.status(400).json({ error: "Invalid status provided. Accepted values are submitted, approved, or rejected." });
  }

  // Append additional details from payload if available
  if (payload && payload.details) {
    message += `\n\n**Details:** ${payload.details}`;
  }

  try {
    // Fetch the Discord user by their ID
    const user = await client.users.fetch(discordId);
    if (!user) {
      return res.status(404).json({ error: "Discord user not found." });
    }

    // Send a DM to the user with the notification message
    await user.send(message);
    console.log(`Notification sent to ${user.tag} (${discordId}): ${message}`);
    return res.status(200).json({ success: true, message: "Notification sent successfully." });
  } catch (error) {
    console.error("Error sending notification:", error);
    return res.status(500).json({ error: "Internal server error. Could not send notification." });
  }
});

// When the Discord bot is ready, start the Express server
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  app.listen(port, () => {
    console.log(`HTTP server is running on port ${port}`);
  });
});

// Log in to Discord with your bot token
client.login(process.env.BOT_TOKEN);