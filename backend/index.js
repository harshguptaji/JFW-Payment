import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { createServer } from "node:http";
import { Server } from "socket.io";
const {
  MONGO_URI,
  CLIENT_ORIGIN = "http://localhost:5173",
  PORT = 5000,
} = process.env;
if (!MONGO_URI) throw new Error("Configure .env first");
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});
const app = express(),
  server = createServer(app),
  io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
const Payment = mongoose.model(
  "Payment",
  new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      registrationNumber: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80,
      },
      amountPaise: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger,
      },
      photo: { url: String, publicId: String },
    },
    { timestamps: true },
  ),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)),
});
app.post("/api/payments", upload.single("photo"), async (req, res, next) => {
  let asset;
  try {
    const { name, registrationNumber, amount } = req.body;
    const paise = Math.round(Number(amount) * 100);
    if (
      !name?.trim() ||
      name.length > 120 ||
      !registrationNumber?.trim() ||
      registrationNumber.length > 80 ||
      !/^\d+(\.\d{1,2})?$/.test(amount || "") ||
      !Number.isSafeInteger(paise) ||
      paise < 1 ||
      !req.file
    )
      return res
        .status(400)
        .json({ message: "Enter valid details and a JPG, PNG or WebP photo" });
    asset = await new Promise((resolve, reject) =>
      cloudinary.uploader
        .upload_stream(
          {
            folder: "jfw-payments",
            resource_type: "image",
            transformation: [{ width: 800, height: 800, crop: "limit" }],
          },
          (err, result) => (err ? reject(err) : resolve(result)),
        )
        .end(req.file.buffer),
    );
    const payment = await Payment.create({
      name,
      registrationNumber,
      amountPaise: paise,
      photo: { url: asset.secure_url, publicId: asset.public_id },
    });
    io.emit("payment:created", payment);
    res.status(201).json(payment);
  } catch (err) {
    if (asset)
      await cloudinary.uploader.destroy(asset.public_id).catch(() => {});
    next(err);
  }
});
app.get("/api/payments", async (req, res, next) => {
  try {
    res.json(await Payment.find().sort({ createdAt: -1 }).limit(200).lean());
  } catch (e) {
    next(e);
  }
});
app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err instanceof multer.MulterError ? 400 : 500)
    .json({
      message:
        err instanceof multer.MulterError
          ? err.message
          : "Unable to complete request",
    });
});
await mongoose.connect(MONGO_URI);
server.listen(PORT, () => console.log(`JFW server running on ${PORT}`));
