// backend/utils/contentFilter.js

const forbiddenWords = [
  'onlyfans', 
  'patreon', 
  'fansly', 
  'mi link en bio', 
  'estafa', 
  'fraude'
];

const containsForbiddenWords = (text) => {
  if (!text) return false;
  
  // Lo forzamos a ser un String por si el Frontend lo envió de otra forma
  const stringText = String(text).toLowerCase();
  
  return forbiddenWords.some(word => stringText.includes(word));
};

module.exports = { containsForbiddenWords };