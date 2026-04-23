// Import required modules for messaging functionality and database operations
const express = require("express");
const { ObjectId } = require("mongodb");

// Ensures only logged-in users can access messaging features
const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Function to safely validate and convert string IDs into MongoDB ObjectId format
function safeObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

// Identifies whether the message belongs to the current user
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

// Function to construct chat details including user information,
// item details and contact visibility settings
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

// Route to start a new secure chat or retrieve an existing chat
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

    if (report.ownerUserId === req.user.id) {  // Prevent users from messaging their own reported items
      return res.status(400).json({ message: "You cannot message your own report" });
    }

    let chat = await db.collection("messages").findOne({
      reportId: reportId,
      ownerUserId: report.ownerUserId,
      claimantUserId: req.user.id
    });

    if (!chat) {
      const newChat = {  // Create a new chat record in the database
  type: "chat",  
  reportId: reportId,
  ownerUserId: report.ownerUserId,
  claimantUserId: req.user.id,
  claimId: "",
  contactUnlocked: false,  // Contact information is locked until the claim is verified

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

// Route to retrieve all chat conversations for the logged-in user
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

// Route to load messages for a specific chat conversation
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

    // Verify that the user is a participant in the chat
    const isParticipant =  
      chat.ownerUserId === req.user.id || chat.claimantUserId === req.user.id;

    if (!isParticipant) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const messages = await db.collection("messages")
      .find({
        type: "message",   
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

// Route to send a secure message between users
router.post("/:chatId/send", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const io = req.app.get("io");

    const chatObjectId = safeObjectId(req.params.chatId);
    const text = String(req.body.text || "").trim();

    if (!chatObjectId) {
      return res.status(400).json({ message: "Invalid chat id" });
    }

    if (!text) {  // Validate that message text is provided before sending
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

    // Insert message into database collection
    const result = await db.collection("messages").insertOne(message);

    // Update chat record with latest message details
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

    // Save notification to database when a new message is received
    await db.collection("notifications").insertOne({
      userId: receiverUserId,
      type: "message",
      message: "You received a new secure message",
      chatId: chat._id.toString(),
      isRead: false,
      createdAt: new Date()
    });

    // Emit real-time notification to the receiver using Socket.IO
    io.to(`user:${receiverUserId}`).emit(
      "newNotification",
      {
        type: "message",
        text: "You received a new secure message",
        chatId: chat._id.toString()
      }
    );

    // Emit real-time message event to update chat instantly
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