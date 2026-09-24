import { createContext, useContext, useEffect } from 'react';

/**
 * Page-level WhatsApp context: pages (e.g. a product page) register a context-aware message
 * (product, storage, colour, SKU); the floating button uses it instead of the generic greeting.
 */
export const WhatsAppMessageContext = createContext<{
  message: string | null;
  setMessage: (message: string | null) => void;
}>({ message: null, setMessage: () => undefined });

export function useWhatsAppMessage(message: string | null) {
  const { setMessage } = useContext(WhatsAppMessageContext);
  useEffect(() => {
    setMessage(message);
    return () => setMessage(null);
  }, [message, setMessage]);
}

export function useCurrentWhatsAppMessage() {
  return useContext(WhatsAppMessageContext).message;
}
