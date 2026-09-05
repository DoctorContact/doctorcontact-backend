export const normalizePhone = (phone) => {
  if (!phone) return null;
  // Remove everything except numbers
  let cleaned = phone.replace(/\D/g, ''); 
  
  // Strip "91" if it's attached as a country code
  if (cleaned.length > 10 && cleaned.startsWith('91')) {
    cleaned = cleaned.substring(cleaned.length - 10);
  }
  
  return cleaned;
};