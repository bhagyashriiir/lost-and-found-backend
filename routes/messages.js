const express = require("express");
const { ObjectId } = require("mongodb");

const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function safeObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function formatMessage(message, currentUserId) {
  return {
    id: message._id.toString(),
    chatId: message.chatId,
    senderUserId: message.senderUserId,
    text: message.text,
    createdAt: message.createdAt,
    isMine: message.senderUserId === currentUserId
  };
}

async function buildChatPayload(db, chat, currentUserId) {
  const owner = await db.collection("users").findOne(
    { _id: new ObjectId(chat.ownerUserId) },
    { projection: { password: 0 } }
  );

  const claimant = await db.collection("users").findOne(
    { _id: new ObjectId(chat.claimantUserId) },
    { projection: { password: 0 } }
  );

  const report = await db.collection("reports").findOne({
    _id: new ObjectId(chat.reportId)
  });

  const isOwner = chat.ownerUserId === currentUserId;
  const otherUser = isOwner ? claimant : owner;

  const anonymousName = isOwner ? "Claimant" : "Item Owner";

  return {
    id: chat._id.toString(),
    reportId: chat.reportId,
    claimId: chat.claimId || "",
    itemName: report?.itemName || "Item",
    itemStatus: report?.status || "Open",
    anonymousMode: !chat.contactUnlocked,
    contactUnlocked: !!chat.contactUnlocked,
    currentUserRole: isOwner ? "owner" : "claimant",
    otherUser: {
      id: otherUser?._id?.toString() || "",
      displayName: chat.contactUnlocked
        ? (otherUser?.name || anonymousName)
        : anonymousName,
      email: chat.contactUnlocked ? (otherUser?.email || "") : "",
      phone: chat.contactUnlocked ? (otherUser?.phone || "") : ""
    },
    lastMessage: chat.lastMessage || "",
    lastMessageAt: chat.lastMessageAt || null,
    createdAt: chat.createdAt
  };
}

/**
 * Start or get a chat for a report
 * body: { reportId }
 */
router.post("/start", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { reportId } = req.body;

    const reportObjectId = safeObjectId(reportId);

    if (!reportObjectId) {
      return res.status(400).json({ message: "Invalid report id" });
    }

    const report = await db.collection("reports").findOne({ _id: reportObjectId });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.ownerUserId === req.user.id) {
      return res.status(400).json({ message: "You cannot message your own report" });
    }

    let chat = await db.collection("messages").findOne({
      reportId: reportId,
      ownerUserId: report.ownerUserId,
      claimantUserId: req.user.id
    });

    if (!chat) {
      const newChat = {
  type: "chat",   // ⭐ REQUIRED

  reportId: reportId,
  ownerUserId: report.ownerUserId,
  claimantUserId: req.user.id,
  claimId: "",
  contactUnlocked: false,

  lastMessage: "",
  lastMessageAt: null,

  createdAt: new Date(),
  updatedAt: new Date()
};

      const result = await db.collection("messages").insertOne(newChat);
      chat = await db.collection("messages").findOne({ _id: result.insertedId });
    }

    const payload = await buildChatPayload(db, chat, req.user.id);
    return res.json(payload);
  } catch (error) {
    console.error("Start chat error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

/**
 * Get all chats for logged-in user
 */

router.get("/threads", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const chats = await db.collection("messages")
      .find({
        type: "chat",
        $or: [
          { ownerUserId: req.user.id },
          { claimantUserId: req.user.id }
        ]
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .toArray();

    const payload = await Promise.all(
      chats.map((chat) => buildChatPayload(db, chat, req.user.id))
    );

    res.json(payload);
  } catch (error) {
    console.error("Load threads error:", error);
    res.status(500).json({
      message: "Failed to load threads"
    });
  }
});

/**
 * Get one chat + messages
 */
router.get("/:chatId", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const chatObjectId = safeObjectId(req.params.chatId);

    if (!chatObjectId) {
      return res.status(400).json({ message: "Invalid chat id" });
    }

    const chat = await db.collection("messages").findOne({ _id: chatObjectId });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isParticipant =
      chat.ownerUserId === req.user.id || chat.claimantUserId === req.user.id;

    if (!isParticipant) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const messages = await db.collection("messages")
      .find({
        type: "message",   // ✅ ADD THIS
        chatId: chat._id.toString()
      })

      .sort({ createdAt: 1 })
      .toArray();

    const chatPayload = await buildChatPayload(db, chat, req.user.id);

    res.json({
      chat: chatPayload,
      messages: messages.map((msg) => formatMessage(msg, req.user.id))
    });
  } catch (error) {
    console.error("Get chat error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * Send message
 * body: { text }
 */
router.post("/:chatId/send", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const io = req.app.get("io");

    const chatObjectId = safeObjectId(req.params.chatId);
    const text = String(req.body.text || "").trim();

    if (!chatObjectId) {
      return res.status(400).json({ message: "Invalid chat id" });
    }

    if (!text) {
      return res.status(400).json({ message: "Message text is required" });
    }

    const chat = await db.collection("messages").findOne({
      _id: chatObjectId
    });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isParticipant =
      chat.ownerUserId === req.user.id ||
      chat.claimantUserId === req.user.id;

    if (!isParticipant) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const message = {
      type: "message",
      chatId: chat._id.toString(),
      senderUserId: req.user.id,
      text,
      createdAt: new Date()
    };

    const result = await db.collection("messages").insertOne(message);

    await db.collection("messages").updateOne(
      { _id: chat._id },
      {
        $set: {
          lastMessage: text,
          lastMessageAt: message.createdAt,
          updatedAt: new Date()
        }
      }
    );

    const savedMessage = {
      ...message,
      _id: result.insertedId
    };

    const outbound = formatMessage(savedMessage, req.user.id);

    // Determine receiver
    const receiverUserId =
      chat.ownerUserId === req.user.id
        ? chat.claimantUserId
        : chat.ownerUserId;

    console.log("NOTIFICATION SENT TO:", receiverUserId);

    // Save notification
    await db.collection("notifications").insertOne({
      userId: receiverUserId,
      type: "message",
      message: "You received a new secure message",
      chatId: chat._id.toString(),
      isRead: false,
      createdAt: new Date()
    });

    // Emit notification
    io.to(`user:${receiverUserId}`).emit(
      "newNotification",
      {
        type: "message",
        text: "You received a new secure message",
        chatId: chat._id.toString()
      }
    );

    // Emit real-time message
    io.to(`chat:${chat._id.toString()}`).emit(
      "new-message",
      {
        chatId: chat._id.toString(),
        message: outbound
      }
    );

    res.status(201).json({
      message: "Message sent successfully",
      data: outbound
    });

  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;