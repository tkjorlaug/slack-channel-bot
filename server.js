import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const {
  SLACK_BOT_TOKEN,   // Bot token (xoxb-...)
  ADMIN_CHANNEL_ID,  // Channel ID of your admin channel (e.g. #feed-automation-admin)
  PORT = 3000,
} = process.env;

// ─── Slack API helper ────────────────────────────────────────────────────────

async function slackAPI(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error [${method}]: ${data.error}`);
  return data;
}

// ─── 1. Webhook — receives requests from Slack Workflow Builder ──────────────

app.post("/request-channel", async (req, res) => {
  const {
    channel_name,
    requester_id,
    channel_type,
    channel_privacy,
    channel_topic,
    channel_description,
    channel_owner,
  } = req.body;

  if (!channel_name || !requester_id) {
    return res.status(400).json({ error: "Missing channel_name or requester_id" });
  }

  // Sanitize channel name: lowercase, no spaces, max 80 chars
  const sanitized = channel_name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 80);

  try {
    await slackAPI("chat.postMessage", {
      channel: ADMIN_CHANNEL_ID,
      text: `New Channel Request: #${sanitized}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🔔 New Channel Request!" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Requested by:*\n<@${requester_id}>` },
            { type: "mrkdwn", text: `*Channel Name:*\n#${sanitized}` },
            { type: "mrkdwn", text: `*Type:*\n${channel_type || "N/A"}` },
            { type: "mrkdwn", text: `*Privacy:*\n${channel_privacy || "Public"}` },
            { type: "mrkdwn", text: `*Topic:*\n${channel_topic || "N/A"}` },
            { type: "mrkdwn", text: `*Description:*\n${channel_description || "N/A"}` },
            { type: "mrkdwn", text: `*Owner:*\n${channel_owner || "N/A"}` },
          ],
        },
        {
          type: "actions",
          block_id: "approval_actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Approve" },
              style: "primary",
              action_id: "approve_channel",
              value: JSON.stringify({
                channel_name: sanitized,
                requester_id,
                channel_type,
                channel_privacy,
                channel_topic,
                channel_description,
                channel_owner,
              }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "❌ Deny" },
              style: "danger",
              action_id: "deny_channel",
              value: JSON.stringify({ channel_name: sanitized, requester_id }),
            },
          ],
        },
      ],
    });

    res.status(200).json({ message: "Request submitted for approval." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. Interactivity — handles Approve / Deny button clicks ─────────────────

app.post("/slack/actions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  const action = payload.actions[0];
  const { channel_name, requester_id } = JSON.parse(action.value);
  const adminWhoActed = payload.user.id;
  const messageTs = payload.message.ts;
  const channelOfMessage = payload.channel.id;

  // Acknowledge immediately
  res.status(200).send();

  try {
    if (action.action_id === "approve_channel") {
      // Create the channel
      const created = await slackAPI("conversations.create", {
        name: channel_name,
        is_private: false,
      });
      const newChannelId = created.channel.id;

      // Add the requester to the new channel
      await slackAPI("conversations.invite", {
        channel: newChannelId,
        users: requester_id,
      });

      // Update the approval card to show approved
      await slackAPI("chat.update", {
        channel: channelOfMessage,
        ts: messageTs,
        text: `✅ Approved: #${channel_name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *Approved* by <@${adminWhoActed}>\n*Channel created:* <#${newChannelId}>\n*Requester:* <@${requester_id}>`,
            },
          },
        ],
      });

      // DM the requester
      await slackAPI("chat.postMessage", {
        channel: requester_id,
        text: `Hey! Your public channel *#${channel_name}* is live! 🎉\n\nYou've been added — go check it out: <#${newChannelId}>\n\nLet us know if you need anything else!\n-IS Team`,
      });

    } else if (action.action_id === "deny_channel") {
      // Update the approval card to show denied
      await slackAPI("chat.update", {
        channel: channelOfMessage,
        ts: messageTs,
        text: `❌ Denied: #${channel_name}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `❌ *Denied* by <@${adminWhoActed}>\n*Channel:* #${channel_name}\n*Requester:* <@${requester_id}>`,
            },
          },
        ],
      });

      // DM the requester
      await slackAPI("chat.postMessage", {
        channel: requester_id,
        text: `Your request for *#${channel_name}* was reviewed and unfortunately denied. Reach out to your admin if you have questions.\n-IS Team`,
      });
    }
  } catch (err) {
    console.error("Action handling error:", err);
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/", (_, res) => res.send("Slack Channel Bot is running ✅"));

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
