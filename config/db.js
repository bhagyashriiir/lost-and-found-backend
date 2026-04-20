const { MongoClient } = require("mongodb");

let db;

async function connectDB() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();

  db = client.db("lost&found");
  console.log("MongoDB Atlas connected");
}

function getDB() {
  if (!db) {
    throw new Error("Database not connected");
  }
  return db;
}

module.exports = {
  connectDB,
  getDB
};