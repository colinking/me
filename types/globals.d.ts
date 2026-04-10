declare global {
  interface Window {
    analytics?: {
      track: (
        event: string,
        properties?: Record<string, string | number | boolean | null | undefined>,
      ) => void;
    };
  }
}

export {};
