require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const certRoutes = require('./routes/certs');

const app = express();

// Middleware
app.use(cors({
  origin: [ 'https://certi-chain-project.vercel.app',
    'https://certi-chain-project-94wrfsdpl-theyashvermaas-projects.vercel.app',
    'https://certi-chain-project-3j5aey6v2-theyashvermaas-projects.vercel.app',
    'https://certi-chain-project-git-main-theyashvermaas-projects.vercel.app',
    'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/certs', certRoutes);

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });