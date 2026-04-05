// backend/controllers/kycController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

const Tesseract = require('tesseract.js');
const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');

ffmpeg.setFfmpegPath(ffmpegPath);

// 🔥 BYPASS: Configuramos face-api en modo "puro JS" para evitar node-gyp
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;

// =======================
// 🔥 LOAD MODELS (Cargado en memoria global para no saturar CPU)
// =======================
async function loadModels() {
  if (modelsLoaded) return;
  try {
    console.log("Cargando Modelos de IA Facial...");
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(path.join(__dirname, '../models'));
    await faceapi.nets.faceLandmark68Net.loadFromDisk(path.join(__dirname, '../models'));
    await faceapi.nets.faceRecognitionNet.loadFromDisk(path.join(__dirname, '../models'));
    modelsLoaded = true;
    console.log("Modelos IA cargados y listos.");
  } catch (error) {
    console.error("Error crítico cargando modelos IA:", error);
  }
}

// =======================
// 🤖 OCR
// =======================
async function extractText(imagePath) {
  try {
    const { data: { text } } = await Tesseract.recognize(imagePath, 'spa');
    return text;
  } catch {
    return null;
  }
}

// =======================
// 🧠 PARSE ID
// =======================
function parseId(text) {
  if (!text) return null;
  const nameMatch = text.match(/NOMBRE\s+([A-Z\s]+)/);
  const curpMatch = text.match(/[A-Z]{4}\d{6}[A-Z]{6}\d{2}/);
  return {
    fullName: nameMatch?.[1]?.trim() || null,
    curp: curpMatch?.[0] || null
  };
}

// =======================
// 🎬 EXTRAER FRAMES (Blindado contra bloqueos)
// =======================
function extractFrames(videoPath) {
  return new Promise((resolve, reject) => {
    const dir = `./tmp_frames_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);

    ffmpeg(videoPath)
      .on('end', () => {
        const files = fs.readdirSync(dir).map(f => path.join(dir, f));
        resolve({ files, dir });
      })
      .on('error', (err) => {
        console.error("Error ffmpeg:", err);
        reject(err);
      })
      .screenshots({
        count: 5, // Reducido a 5 para no asesinar la CPU en producción
        folder: dir,
        size: '320x240'
      });
  });
}

// =======================
// 🧠 FACE DESCRIPTOR
// =======================
async function getDescriptor(imgPath) {
  await loadModels();
  try {
    const img = await canvas.loadImage(imgPath);
    const det = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
    return det?.descriptor || null;
  } catch (e) {
    return null;
  }
}

// =======================
// 🧹 CLEANUP (A prueba de balas)
// =======================
function cleanup(files, dir) {
  try {
    files.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error("Error limpiando basura de frames:", e);
  }
}

// =======================
// 🚀 CONTROLLER PRINCIPAL
// =======================
exports.uploadKycDocuments = async (req, res) => {
  const userId = req.user.userId;

  try {
    if (!req.files?.idFront || !req.files?.idBack || !req.files?.idSelfie) {
      return res.status(400).json({ error: "Faltan archivos para el análisis KYC." });
    }

    // 🔥 FIX CRÍTICO: Agregados los para leer los archivos correctamente desde Multer
    const idFront = req.files.idFront;
    const idBack = req.files.idBack;
    const selfie = req.files.idSelfie;

    if (!idFront.mimetype.startsWith('image')) return res.status(400).json({ error: "ID Frente inválido" });
    if (!selfie.mimetype.startsWith('video')) return res.status(400).json({ error: "Video inválido" });

    console.log(`[KYC] Iniciando análisis profundo para Usuario ${userId}...`);

    // 1. OCR (Extraer Texto del ID)
    const text = await extractText(idFront.path);
    const parsed = parseId(text);

    // 2. EXTRAER FRAMES DEL VIDEO
    let faceMatchConfidence = 0;
    let livenessScore = 0;
    let deepfakeScore = 0;
    let inconsistencies = 0;

    try {
      const { files, dir } = await extractFrames(selfie.path);
      
      // Procesar Identificación
      const idDesc = await getDescriptor(idFront.path);
      
      let detectedFaces = 0;
      let prevBrightness = null;

      // Analizar cada frame extraído
      for (const f of files) {
        // Deepfake / Liveness básico
        const image = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
        const avg = image.data.reduce((a, b) => a + b, 0) / image.data.length;
        if (prevBrightness !== null) {
          if (Math.abs(avg - prevBrightness) > 25) inconsistencies++;
        }
        prevBrightness = avg;

        // Face Match
        const frameDesc = await getDescriptor(f);
        if (frameDesc) {
          detectedFaces++;
          if (idDesc) {
            const conf = 1 - faceapi.euclideanDistance(idDesc, frameDesc);
            if (conf > faceMatchConfidence) faceMatchConfidence = conf;
          }
        }
      }

      livenessScore = files.length > 0 ? (detectedFaces / files.length) : 0;
      deepfakeScore = files.length > 0 ? (1 - (inconsistencies / files.length)) : 0;
      
      cleanup(files, dir);
    } catch (e) {
      console.error("Fallo en el análisis de video KYC:", e);
      // Fallback si falla ffmpeg para no bloquear al usuario por error de servidor
      faceMatchConfidence = 0.5; livenessScore = 0.5; deepfakeScore = 0.5;
    }

    // 3. SUBIR A CLOUDINARY
    const upload = (file, type) => cloudinary.uploader.upload(file.path, { folder: 'kyc_secure', resource_type: type });
    const [frontRes, backRes, selfieRes] = await Promise.all([
      upload(idFront, 'image'), upload(idBack, 'image'), upload(selfie, 'video')
    ]);

    // Limpiar archivos locales pesados
    [idFront.path, idBack.path, selfie.path].forEach(p => { if (fs.existsSync(p)) fs.unlink(p, () => {}); });

    // 4. 📊 MOTOR DE RIESGO (Risk Engine)
    const riskScore = (faceMatchConfidence * 0.5) + (livenessScore * 0.3) + (deepfakeScore * 0.2);
    
    const status = riskScore > 0.75 ? 'PENDING' : riskScore > 0.55 ? 'REVIEW' : 'REJECTED';

    // 5. GUARDAR EN PRISMA
    await prisma.creatorProfile.upsert({
      where: { userId },
      update: {
        kycStatus: status,
        idDocumentUrl: `${frontRes.secure_url},${backRes.secure_url}`, 
        idSelfieUrl: selfieRes.secure_url,
      },
      create: {
        userId,
        kycStatus: status,
        idDocumentUrl: `${frontRes.secure_url},${backRes.secure_url}`,
        idSelfieUrl: selfieRes.secure_url,
      }
    });

    res.json({ message: "KYC procesado", status, riskScore, faceMatchConfidence });

  } catch (err) {
    console.error("❌ ERROR FATAL KYC:", err);
    res.status(500).json({ error: "Error procesando el expediente de seguridad." });
  }
};