// backend/utils/aiModerator.js

// ==========================================
// 🛡️ CAPA 1: DICCIONARIO BÁSICO (100% GRATIS Y RÁPIDO)
// ==========================================
const badWords = [
  'fraude', 'estafa', 'ponzi', 'ilegal', 'asesinato', 'narcotráfico',
  'cp', 'menor de edad', 'violación', 'suicidio', // Agrega más según tus reglas
];

/**
 * Filtro rápido: Revisa si el texto contiene palabras estrictamente prohibidas.
 * Devuelve "true" si el texto es tóxico.
 */
const quickFilter = (text) => {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return badWords.some(word => lowerText.includes(word));
};

// ==========================================
// 🧠 CAPA 2: INTELIGENCIA ARTIFICIAL (Para casos complejos o reportes)
// ==========================================
/**
 * Envía el texto a una IA externa para análisis profundo de intenciones.
 * @param {string} text - El texto a analizar
 * @returns {object} - { isToxic: boolean, reason: string }
 */
const analyzeWithAI = async (text) => {
  // ⚠️ NOTA DE ARQUITECTURA: 
  // Aquí es donde conectaremos el SDK de Gemini o OpenAI más adelante.
  // Por ahora, lo simularemos para que tu servidor no se rompa mientras programas.
  
  console.log(`🤖 [IA Moderadora] Analizando texto: "${text.substring(0, 30)}..."`);
  
  // Simulamos que la IA tarda 1 segundo en "pensar"
  await new Promise(resolve => setTimeout(resolve, 1000)); 

  // Simulamos la respuesta de la IA
  return {
    isToxic: false,
    reason: 'El texto parece seguro, no viola los términos de servicio.',
    confidenceScore: 0.99
  };
};

module.exports = {
  quickFilter,
  analyzeWithAI
};