// index.js
require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const app = express();
const port = process.env.PORT || 3000;
const DISCORD_INTEGRATION_ENABLED = process.env.DISCORD_INTEGRATION_ENABLED === 'true';

// Create Discord client with proper intents and partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel] // Correct syntax for partials
});

// Middleware to parse JSON request bodies
app.use(express.json());


// Add this to your index.js file with the other routes
app.get('/', (req, res) => {
    res.send('Discord Moderator Notification Bot API - Use POST /notify to send notifications');
  });
  
// Add a simple health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    discordConnected: client.isReady() 
  });
});

/**
 * POST /notify
 * Receives notifications from the moderator application service.
 */
app.post('/notify', async (req, res) => {
  // Check if Discord integration is enabled
  if (!DISCORD_INTEGRATION_ENABLED) {
    return res.status(503).json({ error: "Discord integration is currently disabled." });
  }

  // Add request validation with destructuring and defaults
  const { discordId, status, payload = {} } = req.body;

  // Validate required fields
  if (!discordId || !status) {
    return res.status(400).json({ error: "Missing discordId or status in request body." });
  }

  // Validate discordId format (must be 17-19 digits)
  const discordIdRegex = /^\d{17,19}$/;
  if (!discordIdRegex.test(discordId)) {
    return res.status(400).json({ error: "Invalid Discord ID format." });
  }

  // Check if bot is ready
  if (!client.isReady()) {
    return res.status(503).json({ error: "Discord bot is not connected." });
  }

  // Validate status value against allowed options
  const validStatuses = ["submitted", "approved", "rejected"];
  if (!validStatuses.includes(status.toLowerCase())) {
    return res.status(400).json({ 
      error: `Invalid status provided. Must be one of: ${validStatuses.join(', ')}.` 
    });
  }

  // Build the message based on the status provided
  let message = "";
  switch (status.toLowerCase()) {
    case "submitted":
      message = `Your moderator application has been **submitted**. We have received your application and will review it soon.`;
      break;
    case "approved":
      message = `🎉 Congratulations! Your moderator application has been **approved**. Welcome to the team! Please check your dashboard for further instructions.`;
      break;
    case "rejected":
      message = `We regret to inform you that your moderator application has been **rejected**.`;
      break;
  }

  // Append additional details from payload if available
  if (payload.details) {
    message += `\n\n**Details:** ${payload.details}`;
  }

  try {
    // Fetch the Discord user by their ID with error handling
    let user;
    try {
      user = await client.users.fetch(discordId);
    } catch (fetchError) {
      return res.status(404).json({ error: "Discord user not found or bot cannot access this user." });
    }

    // Send a DM to the user with the notification message
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

// Set up error handling for Discord client
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// Rate limit handling
const rateLimits = {};
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  if (!rateLimits[ip]) {
    rateLimits[ip] = { count: 1, timestamp: now };
    return next();
  }
  
  if (now - rateLimits[ip].timestamp < 60000) { // 1 minute window
    if (rateLimits[ip].count >= 10) { // Max 10 requests per minute
      return res.status(429).json({ error: "Rate limit exceeded. Try again later." });
    }
    rateLimits[ip].count++;
  } else {
    rateLimits[ip] = { count: 1, timestamp: now };
  }
  
  next();
});

// When the Discord bot is ready, start the Express server
client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
  app.listen(port, () => {
    console.log(`HTTP server is running on port ${port}`);
  });
});

// Handle graceful shutdown
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