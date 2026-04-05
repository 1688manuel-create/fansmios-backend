// backend/controllers/kycController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const sharp = require('sharp');

ffmpeg.setFfmpegPath(ffmpegPath);

// 🔥 BYPASS: Modo "puro JS" para evitar caídas de servidor
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;

// =======================
// 🔥 LOAD MODELS (Cargado en memoria)
// =======================
async function loadModels() {
  if (modelsLoaded) return;
  try {
    console.log("Cargando Modelos de IA Facial...");
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(path.join(__dirname, '../models'));
    await faceapi.nets.faceLandmark68Net.loadFromDisk(path.join(__dirname, '../models'));
    await faceapi.nets.faceRecognitionNet.loadFromDisk(path.join(__dirname, '../models'));
    modelsLoaded = true;
    console.log("✅ Modelos IA cargados y listos.");
  } catch (error) {
    console.error("❌ Error crítico cargando modelos IA:", error);
  }
}

// =======================
// 🎬 EXTRAER FRAMES
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
        count: 5,
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
// 🧹 CLEANUP
// =======================
function cleanup(files, dir) {
  try {
    files.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error("Error limpiando basura:", e);
  }
}

// =======================
// 🚀 CONTROLLER PRINCIPAL
// =======================
exports.uploadKycDocuments = async (req, res) => {
  const userId = req.user.userId;

  try {
    // 1. Verificar si Multer nos mandó los archivos
    if (!req.files || !req.files.idFront || !req.files.idBack || !req.files.idSelfie) {
      return res.status(400).json({ error: "Faltan archivos biométricos para el análisis KYC." });
    }

    // 🔥 FIX CRÍTICO: Los son obligatorios para que Cloudinary y FFMPEG no exploten
    const idFront = req.files.idFront[0];
    const idBack = req.files.idBack[0];
    const selfie = req.files.idSelfie[0];

    console.log(`🛡️ [KYC] Iniciando análisis profundo para Usuario ${userId}...`);

    let faceMatchConfidence = 0;
    let livenessScore = 0;
    let deepfakeScore = 0;
    let inconsistencies = 0;

    // 2. MOTOR DE INTELIGENCIA ARTIFICIAL
    try {
      console.log("🎥 Analizando video y extrayendo biometría...");
      const { files, dir } = await extractFrames(selfie.path);
      const idDesc = await getDescriptor(idFront.path);

      let detectedFaces = 0;
      let prevBrightness = null;

      for (const f of files) {
        const image = await sharp(f).greyscale().raw().toBuffer({ resolveWithObject: true });
        const avg = image.data.reduce((a, b) => a + b, 0) / image.data.length;
        if (prevBrightness !== null) {
          if (Math.abs(avg - prevBrightness) > 25) inconsistencies++;
        }
        prevBrightness = avg;

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
      console.log("✅ Análisis IA completado exitosamente.");
    } catch (e) {
      console.error("⚠️ Fallo interno en el motor de IA:", e);
      // Fallback seguro si el video está dañado
      faceMatchConfidence = 0.5; livenessScore = 0.5; deepfakeScore = 0.5;
    }

    // 3. SUBIR A CLOUDINARY
    console.log("☁️ Transfiriendo expedientes a la nube de seguridad...");
    const upload = (file, type) => cloudinary.uploader.upload(file.path, { folder: 'kyc_secure', resource_type: type });
    
    const [frontRes, backRes, selfieRes] = await Promise.all([
      upload(idFront, 'image'), 
      upload(idBack, 'image'), 
      upload(selfie, 'video')
    ]);

    // Limpiar archivos locales pesados del servidor Coolify
    [idFront.path, idBack.path, selfie.path].forEach(p => { if (fs.existsSync(p)) fs.unlink(p, () => {}); });

    // 4. 📊 MOTOR DE RIESGO
    const riskScore = (faceMatchConfidence * 0.5) + (livenessScore * 0.3) + (deepfakeScore * 0.2);
    console.log(`📊 [KYC] Score Final Calculado: ${riskScore}`);

    const status = riskScore > 0.75 ? 'PENDING' : riskScore > 0.55 ? 'REVIEW' : 'REJECTED';

    // 5. GUARDAR EN LA BASE DE DATOS
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

    res.json({ message: "Expediente KYC procesado con éxito", status, riskScore, faceMatchConfidence });

  } catch (err) {
    console.error("❌ ERROR FATAL KYC:", err);
    res.status(500).json({ error: "Error de servidor al guardar el expediente de seguridad." });
  }
};