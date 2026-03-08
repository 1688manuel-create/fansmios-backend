// backend/controllers/kycController.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.uploadKycDocuments = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Verificamos que el usuario haya enviado los 3 archivos (2 fotos y 1 video)
    if (!req.files || !req.files['idFront'] || !req.files['idBack'] || !req.files['idSelfie']) {
      return res.status(400).json({ error: "Debes enviar los 3 archivos: Frente, Reverso y la Prueba de Vida en Video." });
    }

    // 2. Extraemos las rutas donde se guardaron los archivos (El idSelfie ahora trae un .webm)
    const idFrontUrl = `/uploads/${req.files['idFront'][0].filename}`;
    const idBackUrl = `/uploads/${req.files['idBack'][0].filename}`;
    const livenessVideoUrl = `/uploads/${req.files['idSelfie'][0].filename}`;

    // 🧠 Truco Enterprise: Como en la BD solo tenemos "idDocumentUrl", 
    // guardaremos la foto del Frente y el Reverso unidas por una coma.
    const combinedIdDocumentUrl = `${idFrontUrl},${idBackUrl}`;

    // 3. 🔥 ESCUDO ACTIVADO: Usamos UPSERT en lugar de UPDATE
    // Si es su primera vez, le creamos el perfil. Si lo rechazaste antes, se lo actualizamos.
    await prisma.creatorProfile.upsert({
      where: { userId: userId },
      update: {
        kycStatus: 'PENDING',
        idDocumentUrl: combinedIdDocumentUrl,
        idSelfieUrl: livenessVideoUrl,  // Aquí guardamos la ruta del Video
        kycRejectionReason: null        // Limpiamos cualquier rechazo anterior
      },
      create: {
        userId: userId,
        kycStatus: 'PENDING',
        idDocumentUrl: combinedIdDocumentUrl,
        idSelfieUrl: livenessVideoUrl
      }
    });

    res.status(200).json({ message: "Expediente biométrico recibido exitosamente. En revisión oficial." });
  } catch (error) {
    console.error("Error al subir documentos KYC:", error);
    res.status(500).json({ error: "Error en el servidor al guardar el expediente legal." });
  }
};