export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

export const getOrSetTransferIdempotencyKey = (senderId, receiverId, amount) => {
  if (typeof window === 'undefined') return generateUUID();

  const numAmount = parseFloat(amount);
  const draftSignature =
    senderId && receiverId && !isNaN(numAmount) && numAmount > 0
      ? `finflow_draft_${senderId.trim()}_${receiverId.trim()}_${numAmount}`
      : 'finflow_active_draft_idem';

  let existingKey = sessionStorage.getItem(draftSignature);
  if (!existingKey) {
    existingKey = generateUUID();
    sessionStorage.setItem(draftSignature, existingKey);
  }
  return existingKey;
};

export const clearTransferIdempotencyKey = (senderId, receiverId, amount) => {
  if (typeof window === 'undefined') return;

  const numAmount = parseFloat(amount);
  if (senderId && receiverId && !isNaN(numAmount) && numAmount > 0) {
    sessionStorage.removeItem(`finflow_draft_${senderId.trim()}_${receiverId.trim()}_${numAmount}`);
  }
  sessionStorage.removeItem('finflow_active_draft_idem');
};
