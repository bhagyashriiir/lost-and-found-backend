const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { ObjectId } = require("mongodb");

const { getDB } = require("../config/db");

const router = express.Router();

function getTokenFromHeader(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.split(" ")[1];
}

router.post("/signup", async (req, res) => {
  try {
    console.log("SIGNUP ROUTE HIT");

    const db = getDB();
    const { name, email, password, phone } = req.body;

    console.log("DB name in signup:", db.databaseName);
    console.log("Signup payload:", { name, email, hasPassword: !!password });

    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        message: "Name, email, phone and password are required"
      });
    }

    const existingUser = await db.collection("users").findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists"
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = {
      name,
      email,
      phone,
      password: hashedPassword,
      authProvider: "email",
      bio: "",
      profileImage: "",  
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection("users").insertOne(user);
    console.log("Inserted user id:", result.insertedId.toString());

    const insertedUser = await db.collection("users").findOne({ _id: result.insertedId });
    console.log("Inserted user found immediately after insert:", insertedUser);

    const totalUsers = await db.collection("users").countDocuments();
    console.log("Total users in this DB after insert:", totalUsers);

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is missing in .env"
      });
    }

    const token = jwt.sign(
      {
        id: result.insertedId.toString(),
        email,
        name
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      message: "Signup successful",
      token,
      user: {
        id: result.insertedId.toString(),
        name,
        email,
        phone,
        bio: ""
      }
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({
      message: "Server error during signup"
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    console.log("LOGIN ROUTE HIT");

    const db = getDB();
    const { email, password } = req.body;

    console.log("Login payload:", {
      email,
      hasPassword: !!password
    });

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const user = await db.collection("users").findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "User not found"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid password"
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is missing in .env"
      });
    }

    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        bio: user.bio || "",
        profileImage: user.profileImage || "" 
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Server error during login"
    });
  }
});

router.get("/profile", async (req, res) => {
  try {
    const token = getTokenFromHeader(req);

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized"
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is missing in .env"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDB();

    const user = await db.collection("users").findOne(
      { _id: new ObjectId(decoded.id) },
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    return res.json({
      _id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      bio: user.bio || "",
      profileImage: user.profileImage || ""
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      message: "Server error while loading profile"
    });
  }
});

router.patch("/profile", async (req, res) => {
  try {
    const token = getTokenFromHeader(req);

    if (!token) {
      return res.status(401).json({
        message: "Unauthorized"
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is missing in .env"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDB();

    const { name, bio, phone, profileImage } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "Name is required"
      });
    }

    await db.collection("users").updateOne(
      { _id: new ObjectId(decoded.id) },
      {
        $set: {
          name,
          bio: bio || "",
          phone: phone || "",
          profileImage: profileImage || "", 
          updatedAt: new Date()
        }
      }
    );

    const updatedUser = await db.collection("users").findOne(
      { _id: new ObjectId(decoded.id) },
      { projection: { password: 0 } }
    );

    return res.json({
      message: "Profile updated successfully",
      user: {
  id: updatedUser._id.toString(),
  name: updatedUser.name,
  email: updatedUser.email,
  phone: updatedUser.phone || "",
  bio: updatedUser.bio || "",
  profileImage: updatedUser.profileImage || ""
}
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({
      message: "Server error while updating profile"
    });
  }
});

router.post(
  "/forgot-password",
  async (req, res) => {

    try {

      const { email } =
        req.body;

      const db = getDB();

      const user =
        await db
          .collection("users")
          .findOne({ email });

      if (!user) {

        return res
          .status(404)
          .json({
            message:
              "User not found"
          });

      }

      res.json({
        message:
          "Password reset request received"
      });

    } catch (err) {

      res.status(500).json({
        message:
          "Server error"
      });

    }

  }
);

router.post(
  "/change-password",
  async (req, res) => {
    console.log("CHANGE PASSWORD BODY:", req.body);

    try {

      const {
        email,
        currentPassword,
        newPassword
      } = req.body;

      const db = getDB();

      const user =
        await db
          .collection("users")
          .findOne({
            email: email
          });

      if (!user) {

        return res.status(404).json({
          message: "User not found"
        });

      }

      const isMatch =
        await bcrypt.compare(
          currentPassword,
          user.password
        );

      if (!isMatch) {

        return res.status(400).json({
          message:
            "Current password is incorrect"
        });

      }

      const hashedPassword =
        await bcrypt.hash(
          newPassword,
          10
        );

      await db
        .collection("users")
        .updateOne(
          {
            email: email
          },
          {
            $set: {
              password:
                hashedPassword,
              updatedAt:
                new Date()
            }
          }
        );

      res.json({
        message:
          "Password updated successfully"
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        message: "Server error"
      });

    }

  }
);

const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        message: "No credential provided"
      });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    const email = payload.email;
    const name = payload.name;

    const db = getDB();

    let user = await db
      .collection("users")
      .findOne({ email });

    // If user doesn't exist — create
    if (!user) {
      const result = await db
        .collection("users")
        .insertOne({
          email,
          displayName: name,
          password: null,
          provider: "google",
          createdAt: new Date()
        });

      user = {
        _id: result.insertedId,
        email,
        displayName: name
      };
    }

    // Create JWT
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName
      }
    });

  } catch (error) {
    console.error("Google login error:", error);

    res.status(500).json({
      message: "Google login failed"
    });
  }
});

router.post("/logout", async (req, res) => {
  try {
    res.json({
      message: "Logout successful"
    });
  } catch (error) {
    res.status(500).json({
      message: "Logout failed"
    });
  }
});

module.exports = router;