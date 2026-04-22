const multer = require("multer");
const path = require("path");
const express = require("express");
const { ObjectId } = require("mongodb");

const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");
const {
  detectCategory,
  findPossibleMatches,
  isDuplicate
} = require("../utils/matching");

const router = express.Router();

function normalizeVenueType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("mall")) return "Mall";
  if (normalized.includes("metro")) return "Metro station";
  if (normalized.includes("airport")) return "Airport";
  return value || "";
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

router.get("/", async (req, res) => {
  try {
    const db = getDB();
    const { venueType, category, location, cityArea, q } = req.query;

    const filter = { status: { $in: ["Open", "Resolved"] } };

    if (venueType) filter.venueType = normalizeVenueType(venueType);
    if (category) filter.category = category;
    if (location) filter.location = { $regex: location, $options: "i" };
    if (cityArea) filter.cityArea = { $regex: cityArea, $options: "i" };

    if (q) {
      filter.$or = [
        { itemName: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } }
      ];
    }

    const reports = await db
      .collection("reports")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json(reports);
  } catch (error) {
    console.error("Get reports error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const db = getDB();   // REQUIRED

    const reports = await db
      .collection("reports")
      .find({ ownerUserId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(reports);

  } catch (err) {
    console.error("Fetch my reports error:", err);

    res.status(500).json({
      message: "Failed to fetch reports"
    });
  }
});

router.post(
  "/",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {

      const db = getDB();

      const {
        type,
        userName,
        email,
        phone,
        itemName,
        category,
        location,
        venueType,
        cityArea,
        date,
        time,
        description,
        verificationQuestion1,
        verificationQuestion2
      } = req.body;

      const autoCategory = detectCategory(
        itemName,
        description,
        category
      );

      const imagePath = req.file
        ? `/uploads/${req.file.filename}`
        : null;

      const baseReport = {
        type,
        userName,
        email,
        phone,
        itemName,
        category: autoCategory,
        location,
        venueType: normalizeVenueType(venueType),
        cityArea,
        date,
        time,
        description,
        verificationQuestion1,
        verificationQuestion2,
        image: imagePath,
        status: "Open",
        ownerUserId: req.user.id,
        createdAt: new Date()
      };

      const existingReports = await db
        .collection("reports")
        .find({})
        .toArray();

      baseReport.duplicateFlag = isDuplicate(
        baseReport,
        existingReports
      );

      const possibleMatches = findPossibleMatches(
        baseReport,
        existingReports
      );

      baseReport.possibleMatches = possibleMatches;

      const result = await db
        .collection("reports")
        .insertOne(baseReport);

      const io = req.app.get("io");

      io.emit("reportCreated", {
        message: "New report created"
      });

      res.status(201).json({
        message: baseReport.duplicateFlag
          ? "Report submitted, but a possible duplicate was detected"
          : "Report submitted successfully",
        reportId: result.insertedId,
        autoCategory,
        possibleMatches
      });

    } catch (error) {

      console.error("Create report error:", error);

      res.status(500).json({
        message: "Server error"
      });

    }
  }
);

router.patch("/:id/status", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { status } = req.body;
    const reportId = req.params.id;

    const report = await db.collection("reports").findOne({
      _id: new ObjectId(reportId)
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.ownerUserId !== req.user.id) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await db.collection("reports").updateOne(
      { _id: new ObjectId(reportId) },
      {
        $set: {
          status,
          updatedAt: new Date()
        }
      }
    );

    res.json({ message: "Status updated successfully" });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/all", async (req, res) => {
  const db = getDB();

  const reports = await db
    .collection("reports")
    .find({})
    .toArray();

  res.json(reports);
});

module.exports = router;