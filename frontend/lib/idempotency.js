/**
 * FinFlow Idempotency Assurance Manager
 * Ensures that payment retries, multiple rapid clicks, page reloads, and network drops
 * reuse the exact same Idempotency-Key for a given transfer draft.
 */

export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Get or create a persistent idempotency key for a specific transfer draft.
 * Stored in sessionStorage so page reloads and network disconnect retries
 * reliably send the exact same key to the backend.
 *
 * @param {string} senderId - Sender account UUID
 * @param {string} receiverId - Receiver account UUID
 * @param {number|string} amount - Transfer amount
 * @returns {string} The persistent idempotency key
 */
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

/**
 * Clear the persistent idempotency key from sessionStorage once a transfer completes
 *
 * @param {string} senderId - Sender account UUID
 * @param {string} receiverId - Receiver account UUID
 * @param {number|string} amount - Transfer amount
 */
export const clearTransferIdempotencyKey = (senderId, receiverId, amount) => {
  if (typeof window === 'undefined') return;

  const numAmount = parseFloat(amount);
  if (senderId && receiverId && !isNaN(numAmount) && numAmount > 0) {
    sessionStorage.removeItem(`finflow_draft_${senderId.trim()}_${receiverId.trim()}_${numAmount}`);
  }
  sessionStorage.removeItem('finflow_active_draft_idem');
};
