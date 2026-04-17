// config/db.js
const mongoose = require("mongoose");

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  const conn = await mongoose.connect(process.env.MONGO_URI, {
    bufferCommands: false, // ← critical for Vercel/serverless
  });

  isConnected = true;
  console.log(`MongoDB Connected: ${conn.connection.host}`);
};

module.exports = connectDB;