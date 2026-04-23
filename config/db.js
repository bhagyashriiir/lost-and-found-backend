// Import MongoDB client to establish connection with the database server
const { MongoClient } = require("mongodb");

// Variable to store database connection instance
let db;

// Function to connect to MongoDB Atlas using connection string from environment variables
async function connectDB() {
  const client = new MongoClient(process.env.MONGODB_URI);  
  await client.connect();

  db = client.db("lost&found"); 
  console.log("MongoDB Atlas connected");
}

// Function to retrieve the database instance for use in other modules
function getDB() {
  if (!db) {  // Ensure database connection exists before performing operations
    throw new Error("Database not connected");
  }
  return db;
}

// Export database connection and retrieval functions for use across the application
module.exports = {
  connectDB,
  getDB
};