import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

const {
  SLACK_BOT_TOKEN,
  SLACK_USER_TOKEN,
  SLACK_SIGNING_SECRET,
  ADMIN_CHANNEL_ID,
  PORT = 3000,
} = process.env;

// ─── Raw body parser ──────────────────────────────────────────────────────────

app.use((req, res, next) => {
  let data = "";
  req.on("data", chunk => data += chunk);
  req.on("end", () => {
    req.rawBody = data;
    try {
      req.body = data.startsWith("{") ? JSON.parse(data) : Object.fromEntries(new URLSearchParams(data));
    } catch { req.body = {}; }
    next();
  });
});

// ─── Slack signature verification ─────────────────────────────────────────────

function verifySlack(req) {
  try {
    const ts = req.headers["x-slack-request-timestamp"];
    const sig = req.headers["x-slack-signature"];
    if (!ts || !sig || !SLACK_SIGNING_SECRET) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const base = `v0:${ts}:${req.rawBody || ""}`;
    const hash = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(base, "utf8").digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(sig, "utf8"));
  } catch (e) {
    console.error("Signature verification error:", e);
    return false;
  }
}

// ─── Slack API helper ─────────────────────────────────────────────────────────

async function slackAPI(method, body, useUserToken = false) {
  const token = useUserToken ? SLACK_USER_TOKEN : SLACK_BOT_TOKEN;
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Slack API error [${method}]:`, JSON.stringify(data));
    throw new Error(`Slack API error [${method}]: ${data.error}`);
  }
  return data;
}

// ─── 1. Slash command — opens modal ──────────────────────────────────────────

app.post("/slack/command", async (req, res) => {
  if (!verifySlack(req)) return res.status(401).send("Unauthorized");
  const triggerId = req.body.trigger_id;
  res.status(200).send();

  await slackAPI("views.open", {
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "channel_request_modal",
      title: { type: "plain_text", text: "Request a Channel" },
      submit: { type: "plain_text", text: "Submit" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "input",
          block_id: "blk_privacy",
          label: { type: "plain_text", text: "Should this channel be public or private?" },
          element: {
            type: "static_select",
            action_id: "value",
            options: [
              { text: { type: "plain_text", text: "Public" }, value: "public" },
              { text: { type: "plain_text", text: "Private" }, value: "private" },
            ],
          },
        },
        {
          type: "input",
          block_id: "blk_type",
          label: { type: "plain_text", text: "What type of channel is this?" },
          element: {
            type: "static_select",
            action_id: "value",
            placeholder: { type: "plain_text", text: "Pick a channel type" },
            options: [
              { text: { type: "plain_text", text: "company-" }, value: "company-" },
              { text: { type: "plain_text", text: "event-" }, value: "event-" },
              { text: { type: "plain_text", text: "feed-" }, value: "feed-" },
              { text: { type: "plain_text", text: "hr-" }, value: "hr-" },
              { text: { type: "plain_text", text: "product-" }, value: "product-" },
              { text: { type: "plain_text", text: "project-" }, value: "project-" },
              { text: { type: "plain_text", text: "social-" }, value: "social-" },
              { text: { type: "plain_text", text: "team-" }, value: "team-" },
              { text: { type: "plain_text", text: "topic-" }, value: "topic-" },
            ],
          },
        },
        {
          type: "input",
          block_id: "blk_name",
          label: { type: "plain_text", text: "What should the channel name be?" },
          element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "e.g. marketing" } },
        },
        {
          type: "input",
          block_id: "blk_owner",
          label: { type: "plain_text", text: "Who will own this channel?" },
          element: { type: "users_select", action_id: "value" },
        },
        {
          type: "input",
          block_id: "blk_members",
          label: { type: "plain_text", text: "Who should be added to this channel?" },
          optional: true,
          element: { type: "multi_users_select", action_id: "value", placeholder: { type: "plain_text", text: "Select members..." } },
        },
        {
          type: "input",
          block_id: "blk_topic",
          label: { type: "plain_text", text: "What is the topic of this channel?" },
          element: { type: "plain_text_input", action_id: "value", placeholder: { type: "plain_text", text: "e.g. Marketing campaign updates" } },
        },
        {
          type: "input",
          block_id: "blk_description",
          label: { type: "plain_text", text: "What is the description of this channel?" },
          element: { type: "plain_text_input", action_id: "value", multiline: true, placeholder: { type: "plain_text", text: "Describe the purpose of this channel..." } },
        },
      ],
    },
  });
});

// ─── 2. Actions — modal submission + button clicks ────────────────────────────

app.post("/slack/actions", async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  res.status(200).send();

  // ── Modal submission ──
  if (payload.type === "view_submission" && payload.view.callback_id === "channel_request_modal") {
    const vals = payload.view.state.values;
    const requester_id = payload.user.id;

    const channel_privacy = vals.blk_privacy.value.selected_option.value;
    const channel_type = vals.blk_type.value.selected_option.value;
    const raw_name = vals.blk_name.value.value
      .toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 79);
    const channel_name = `${channel_type}${raw_name}`;
    const channel_owner = vals.blk_owner.value.selected_user;
    const channel_members = vals.blk_members?.value?.selected_users || [];
    const channel_topic = vals.blk_topic.value.value;
    const channel_description = vals.blk_description.value.value;

    await slackAPI("chat.postMessage", {
      channel: ADMIN_CHANNEL_ID,
      text: `New Channel Request: #${channel_name}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "🔔 New Channel Request!" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Requested by:*\n<@${requester_id}>` },
            { type: "mrkdwn", text: `*Channel Name:*\n#${channel_name}` },
            { type: "mrkdwn", text: `*Privacy:*\n${channel_privacy}` },
            { type: "mrkdwn", text: `*Type:*\n${channel_type}` },
            { type: "mrkdwn", text: `*Topic:*\n${channel_topic}` },
            { type: "mrkdwn", text: `*Description:*\n${channel_description}` },
            { type: "mrkdwn", text: `*Owner:*\n<@${channel_owner}>` },
            { type: "mrkdwn", text: `*Members to add:*\n${channel_members.length > 0 ? channel_members.map(m => `<@${m}>`).join(", ") : "None"}` },
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
              value: JSON.stringify({ channel_name, requester_id, channel_privacy, channel_type, channel_topic, channel_description, channel_owner, channel_members }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "❌ Deny" },
              style: "danger",
              action_id: "deny_channel",
              value: JSON.stringify({ channel_name, requester_id }),
            },
          ],
        },
      ],
    });
    return;
  }

  // ── Button clicks ──
  if (payload.type === "block_actions") {
    const action = payload.actions[0];
    const { channel_name, requester_id, channel_privacy, channel_type, channel_topic, channel_description, channel_owner, channel_members } = JSON.parse(action.value);
    const adminWhoActed = payload.user.id;
    const messageTs = payload.message.ts;
    const channelOfMessage = payload.channel.id;

    if (action.action_id === "approve_channel") {
      const created = await slackAPI("conversations.create", {
        name: channel_name,
        is_private: channel_privacy === "private",
      }, true);
      const newChannelId = created.channel.id;

      await slackAPI("conversations.join", { channel: newChannelId });

      if (channel_topic) await slackAPI("conversations.setTopic", { channel: newChannelId, topic: channel_topic });
      if (channel_description) await slackAPI("conversations.setPurpose", { channel: newChannelId, purpose: channel_description });

      try {
        await slackAPI("conversations.invite", { channel: newChannelId, users: requester_id });
      } catch (e) {
        if (!e.message.includes("already_in_channel")) throw e;
      }

      if (channel_members && channel_members.length > 0) {
        try {
          await slackAPI("conversations.invite", { channel: newChannelId, users: channel_members.join(",") });
        } catch (e) {
          if (!e.message.includes("already_in_channel")) throw e;
        }
      }

      await slackAPI("chat.update", {
        channel: channelOfMessage,
        ts: messageTs,
        text: `✅ Approved: #${channel_name}`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "🔔 New Channel Request!" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Requested by:*\n<@${requester_id}>` },
              { type: "mrkdwn", text: `*Channel Name:*\n<#${newChannelId}>` },
              { type: "mrkdwn", text: `*Privacy:*\n${channel_privacy}` },
              { type: "mrkdwn", text: `*Type:*\n${channel_type}` },
              { type: "mrkdwn", text: `*Topic:*\n${channel_topic}` },
              { type: "mrkdwn", text: `*Description:*\n${channel_description}` },
              { type: "mrkdwn", text: `*Owner:*\n<@${channel_owner}>` },
              { type: "mrkdwn", text: `*Members added:*\n${channel_members && channel_members.length > 0 ? channel_members.map(m => `<@${m}>`).join(", ") : "None"}` },
            ],
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `✅ *Approved* by <@${adminWhoActed}>` },
          },
        ],
      });

      await slackAPI("chat.postMessage", {
        channel: requester_id,
        text: `Hey! Your channel *#${channel_name}* is live! 🎉\n\nYou've been added - go check it out: <#${newChannelId}>\n\nLet us know if you need anything else!\n\n-IS Team`,
      });

    } else if (action.action_id === "deny_channel") {
      await slackAPI("chat.update", {
        channel: channelOfMessage,
        ts: messageTs,
        text: `❌ Denied: #${channel_name}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `❌ *Denied* by <@${adminWhoActed}>\n*Channel:* #${channel_name}\n*Requester:* <@${requester_id}>` },
          },
        ],
      });

      await slackAPI("chat.postMessage", {
        channel: requester_id,
        text: `Your request for *#${channel_name}* was reviewed and unfortunately denied. Reach out to your admin if you have questions.\n\n-IS Team`,
      });
    }
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/", (_, res) => res.send("Slack Channel Bot is running ✅"));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  setInterval(() => {
    fetch(`https://slack-channel-bot-8gip.onrender.com/`)
      .then(() => console.log("Keep-alive ping sent"))
      .catch(e => console.error("Keep-alive error:", e));
  }, 10 * 60 * 1000);
});
