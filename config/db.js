const mongoose = require('mongoose');

const connectDB = async () => {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      retries++;
      if (retries >= maxRetries) {
        console.error(`❌ MongoDB Connection Failed after ${maxRetries} attempts: ${error.message}`);
        process.exit(1);
      }
      console.log(`⚠️  MongoDB connection attempt ${retries}/${maxRetries} failed. Retrying in 3s...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
};

module.exports = connectDB;
