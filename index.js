// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;
const DISCORD_INTEGRATION_ENABLED = process.env.DISCORD_INTEGRATION_ENABLED === 'true';

// Enable CORS for all origins (or configure specific origins as needed)
app.use(cors());

// Middleware to parse JSON request bodies
app.use(express.json());

// Rate limit handling middleware (10 requests per minute per IP)
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

// Create Discord client with required intents and partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // Allows handling of DMs not yet cached
});

// Define basic routes

app.get('/', (req, res) => {
  res.send('Discord Moderator Notification Bot API - Use POST /notify to send notifications');
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

  // Validate discordId format: must be 17-19 digits
  const discordIdRegex = /^\d{17,19}$/;
  if (!discordIdRegex.test(discordId)) {
    return res.status(400).json({ error: "Invalid Discord ID format." });
  }

  // Ensure the Discord bot is connected
  if (!client.isReady()) {
    return res.status(503).json({ error: "Discord bot is not connected." });
  }

  const validStatuses = ["submitted", "approved", "rejected"];
  if (!validStatuses.includes(status.toLowerCase())) {
    return res.status(400).json({ 
      error: `Invalid status provided. Must be one of: ${validStatuses.join(', ')}.` 
    });
  }

  // Construct the notification message
  let message = "";
  switch (status.toLowerCase()) {
    case "submitted":
      message = `Your moderator application has been **submitted** and is up for review.`;
      break;
    case "approved":
      message = `🎉 Congratulations! Your moderator application has been **approved** has been approved. You will now move on to the interview and will be contacted within **4-5 days**.`;
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

// Handle Discord client errors
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await client.destroy();
  process.exit(0);
});

// When the Discord bot is ready, start the HTTP server
client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  app.listen(port, () => {
    console.log(`HTTP server is running on port ${port}`);
  });
});

// Log in to Discord with your bot token
client.login(process.env.BOT_TOKEN).catch(error => {
  console.error('Failed to connect to Discord:', error);
  process.exit(1);
});