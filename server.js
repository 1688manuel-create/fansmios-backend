// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const Sentry = require('@sentry/node'); 
const http = require('http');
const { Server } = require('socket.io');

// 🔥 EL CADENERO VIP DE LIVEKIT
const { AccessToken } = require('livekit-server-sdk');
const { verifyToken } = require('./middlewares/authMiddleware');

// Tareas en Segundo Plano (Cron Jobs)
const { startSubscriptionCron } = require('./utils/subscriptionCron'); 
const startBalanceReleaser = require('./cron/balanceReleaser');
const startAccountGuardian = require('./cron/accountGuardian'); 
const cron = require('node-cron'); 
const postController = require('./controllers/postController');

const seriesRoutes = require('./routes/seriesRoutes');

// ==========================================
// 1. INICIALIZACIÓN Y MONITOREO (Sentry)
// ==========================================
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0, 
});

const app = express();

// Confiar en el proxy para el Escudo Anti-Bots
app.set('trust proxy', 1);

const server = http.createServer(app); 
const PORT = process.env.PORT || 5000;

// ==========================================
// 2. SISTEMA MAESTRO DE WEBSOCKETS (USD READY)
// ==========================================
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

try {
  const socketHandler = require('./utils/socketHandler');
  if (typeof socketHandler.init === 'function') {
      socketHandler.init(io); 
  }
  console.log("✅ Antena de Chat Privado conectada.");
} catch (error) {
  console.log("⚠️ Aviso: Antena de Chat requiere revisión.");
}

try {
  // Aquí se carga tu liveSocket.js que ya limpiamos de monedas
  require('./sockets/liveSocket')(io);
  console.log("✅ Antena de Live Streaming conectada.");
} catch (error) {
  console.log("⚠️ Aviso: Antena de Live Streaming en pausa.");
}

// ==========================================
// 3. MIDDLEWARES GLOBALES
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// ==========================================
// 5. ENRUTADOR PRINCIPAL (ARQUITECTURA USD)
// ==========================================
app.get('/', (req, res) => {
  res.json({ message: 'Motor Unicornio funcionando y blindado en Dólares 🚀' });
});

app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/posts', require('./routes/postRoutes'));
app.use('/api/stories', require('./routes/storyRoutes'));
app.use('/api/explore', require('./routes/exploreRoutes')); 
app.use('/api/discover', require('./routes/discoverRoutes'));
app.use('/api/bookmarks', require('./routes/bookmarkRoutes'));

// Nucleo Financiero (Limpios de Coins)
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/finance', require('./routes/monetizationRoutes'));
app.use('/api/wallet', require('./routes/walletRoutes')); 
app.use('/api/webhooks', require('./routes/webhookRoutes'));

app.use('/api/bundles', require('./routes/bundleRoutes'));
app.use('/api/coupons', require('./routes/couponRoutes'));
app.use('/api/promotions', require('./routes/promotionRoutes')); 

app.use('/api/messages', require('./routes/messageRoutes'));
app.use('/api/live', require('./routes/liveRoutes'));
app.use('/api/fans', require('./routes/fanRoutes'));

app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/moderation', require('./routes/moderationRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/referrals', require('./routes/referralRoutes'));
app.use('/api/stats', require('./routes/statsRoutes')); 
app.use('/api/profile/kyc', require('./routes/kycRoutes'));
app.use('/api/2fa', require('./routes/auth2faRoutes'));
app.use('/api/series', seriesRoutes);


// 🔥 RUTA PARA EL BOLETO DE LIVEKIT (MODO INVISIBLE PARA ADMINS)
app.post('/api/livekit/token', verifyToken, async (req, res) => {
  try {
    const { roomName, participantName, isCreator } = req.body;

    // Validación de seguridad para evitar caídas del servidor
    const userRole = req.user?.role ? String(req.user.role).toUpperCase() : 'FAN';
    const isAdmin = userRole === 'ADMIN';

    // Si es Admin, le quitamos el poder de publicar video (Modo Fantasma)
    const canPublishVideo = isCreator && !isAdmin;

    const at = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: participantName,
        ttl: '2h', 
      }
    );

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: canPublishVideo, 
      canSubscribe: true,    
      hidden: isAdmin // Invisibility cloak activo
    });

    const token = await at.toJwt();
    res.json({ token: token });

  } catch (error) {
    console.error("Error generando token de LiveKit:", error);
    res.status(500).json({ error: "No se pudo generar el acceso al Live" });
  }
});

// ==========================================
// 6. TRABAJADORES Y CRON JOBS
// ==========================================
try { require('./workers/broadcastWorker'); } catch(e) {}

// Manejador de Errores de Sentry
Sentry.setupExpressErrorHandler(app);

// Robots en Segundo Plano
startSubscriptionCron(); 
startBalanceReleaser();
startAccountGuardian(); 
console.log('🤖 Motores de Automatización Activados.');

// PERRO GUARDIÁN: Patrulla Anti-IA 3:00 AM
cron.schedule('0 3 * * *', async () => {
  console.log('🐕 [CRON] Despertando al Perro Guardián Anti-IA...');
  
  const mockReq = {};
  const mockRes = {
    status: function(code) {
      return {
        json: function(data) {
          console.log(`🐕 [CRON] Patrullaje finalizado (Status: ${code}):`, data);
        }
      };
    }
  };

  try {
    if (typeof postController.scanExistingPostsForAI === 'function') {
      await postController.scanExistingPostsForAI(mockReq, mockRes);
    } else {
      console.log('⚠️ [CRON] La función scanExistingPostsForAI no se encontró.');
    }
  } catch (error) {
    console.error('❌ [CRON] Error durante el patrullaje:', error);
  }
});

// ==========================================
// 7. ENCENDIDO FINAL
// ==========================================
server.listen(PORT, () => {
  console.log(`🚀 SERVIDOR FANSMIOS OPERANDO EN PUERTO ${PORT}`);
  console.log(`💵 ECONOMÍA: USD / CRIPTO (Sin Monedas Virtuales)`);
});